use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResult {
    data_url: String,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
}

#[tauri::command]
pub fn capture_active_window() -> Result<CaptureResult, String> {
    #[cfg(target_os = "windows")]
    {
        windows_capture::active_window()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("CapSage capture is currently supported on Windows only".into())
    }
}

#[tauri::command]
pub async fn start_region_selection(
    app: tauri::AppHandle,
    width: Option<u32>,
    height: Option<u32>,
    x: Option<i32>,
    y: Option<i32>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        #[cfg(debug_assertions)]
        eprintln!("[region-selector] opening bounded selection window");
        if let Some(existing) = app.get_webview_window("region-selector") {
            existing
                .destroy()
                .map_err(|error| format!("Could not reset the region selector: {error}"))?;
        }

        let (x, y, width, height) = windows_capture::initial_selector_bounds(width, height, x, y)?;

        let selector = WebviewWindowBuilder::new(
            &app,
            "region-selector",
            WebviewUrl::App("index.html".into()),
        )
        .title("Select a region")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        // Keep a taskbar entry as a final native escape hatch even if the
        // selector frontend ever fails before wiring its keyboard handlers.
        .skip_taskbar(false)
        .resizable(true)
        .min_inner_size(240.0, 160.0)
        .shadow(false)
        .visible(true)
        .position(x as f64, y as f64)
        .inner_size(width as f64, height as f64)
        .build()
        .map_err(|error| format!("Could not open the region selector: {error}"))?;
        #[cfg(debug_assertions)]
        eprintln!("[region-selector] native window created");

        let selector_for_setup = selector.clone();
        let (setup_sender, setup_receiver) = tokio::sync::oneshot::channel();
        selector
            .run_on_main_thread(move || {
                use windows::Win32::UI::WindowsAndMessaging::{
                    SetWindowPos, HWND_TOPMOST, SWP_SHOWWINDOW,
                };

                let result = (|| {
                    let hwnd = selector_for_setup.hwnd().map_err(|error| {
                        format!("Could not access the region selector window: {error}")
                    })?;
                    let transitions_disabled = windows::core::BOOL(1);
                    unsafe {
                        windows::Win32::Graphics::Dwm::DwmSetWindowAttribute(
                            hwnd,
                            windows::Win32::Graphics::Dwm::DWMWA_TRANSITIONS_FORCEDISABLED,
                            (&transitions_disabled as *const windows::core::BOOL).cast(),
                            std::mem::size_of::<windows::core::BOOL>() as u32,
                        )
                    }
                    .map_err(|error| {
                        format!("Could not disable selector window animations: {error}")
                    })?;
                    windows_capture::constrain_selector_to_desktop(hwnd)?;
                    unsafe {
                        SetWindowPos(
                            hwnd,
                            Some(HWND_TOPMOST),
                            x,
                            y,
                            width as i32,
                            height as i32,
                            SWP_SHOWWINDOW,
                        )
                    }
                    .map_err(|error| format!("Could not position the region selector: {error}"))?;
                    Ok(())
                })();
                let _ = setup_sender.send(result);
            })
            .map_err(|error| format!("Could not prepare the region selector: {error}"))?;
        if let Err(error) = setup_receiver
            .await
            .map_err(|_| "The region selector setup stopped unexpectedly".to_string())?
        {
            let _ = selector.destroy();
            return Err(error);
        }
        #[cfg(debug_assertions)]
        eprintln!("[region-selector] bounded selection window is ready");
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Region selection is currently supported on Windows only".into())
    }
}

#[tauri::command]
pub fn activate_region_selector(app: tauri::AppHandle) -> Result<(), String> {
    let selector = app
        .get_webview_window("region-selector")
        .ok_or_else(|| "The region selector is no longer open".to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.minimize()
            .map_err(|error| format!("Could not minimize CapSage for region selection: {error}"))?;
    }
    selector
        .set_focus()
        .map_err(|error| format!("Could not focus the region selector: {error}"))?;
    #[cfg(debug_assertions)]
    eprintln!("[region-selector] bounded selection window shown and focused");
    Ok(())
}

#[tauri::command]
pub fn cancel_region_selection(app: tauri::AppHandle) {
    let _ = app.emit("region-selection-cancelled", ());
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    if let Some(selector) = app.get_webview_window("region-selector") {
        let _ = selector.destroy();
    }
}

#[tauri::command]
pub fn capture_selector_region(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let selector = app
            .get_webview_window("region-selector")
            .ok_or_else(|| "The region selector is no longer open".to_string())?;
        let position = selector
            .outer_position()
            .map_err(|error| format!("Could not read the selection position: {error}"))?;
        let size = selector
            .outer_size()
            .map_err(|error| format!("Could not read the selection size: {error}"))?;
        let (desktop_x, desktop_y, desktop_width, desktop_height) =
            windows_capture::virtual_bounds()?;
        let local_x = position.x as i64 - desktop_x as i64;
        let local_y = position.y as i64 - desktop_y as i64;
        if local_x < 0
            || local_y < 0
            || local_x + size.width as i64 > desktop_width as i64
            || local_y + size.height as i64 > desktop_height as i64
        {
            return Err("Keep the selection box entirely within the visible desktop".into());
        }

        let capture_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let result = if let Err(error) = selector.destroy() {
                Err(format!(
                    "Could not remove the selector before capture: {error}"
                ))
            } else {
                match tauri::async_runtime::spawn_blocking(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    unsafe {
                        let _ = windows::Win32::Graphics::Dwm::DwmFlush();
                    }
                    windows_capture::screen_region(
                        local_x as u32,
                        local_y as u32,
                        size.width,
                        size.height,
                    )
                })
                .await
                {
                    Ok(result) => result,
                    Err(error) => Err(format!(
                        "The region capture worker stopped unexpectedly: {error}"
                    )),
                }
            };

            match result {
                Ok(capture) => {
                    let _ = capture_app.emit("region-selected", capture);
                }
                Err(error) => {
                    let _ = capture_app.emit("region-selection-error", error);
                }
            }
            if let Some(main) = capture_app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        });
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Region capture is currently supported on Windows only".into())
    }
}

#[tauri::command]
pub fn save_image(path: String, data_url: String) -> Result<(), String> {
    let (_, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "The editor produced an invalid image".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("Could not decode the image: {error}"))?;
    std::fs::write(&path, bytes).map_err(|error| format!("Could not save {path}: {error}"))
}

fn png_result(
    mut bgra: Vec<u8>,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
) -> Result<CaptureResult, String> {
    for pixel in bgra.chunks_exact_mut(4) {
        pixel.swap(0, 2);
        pixel[3] = 255;
    }

    let image = image::RgbaImage::from_raw(width, height, bgra)
        .ok_or_else(|| "Windows returned an invalid capture buffer".to_string())?;
    let mut encoded = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|error| format!("Could not encode the capture: {error}"))?;

    Ok(CaptureResult {
        data_url: format!(
            "data:image/png;base64,{}",
            STANDARD.encode(encoded.into_inner())
        ),
        width,
        height,
        origin_x,
        origin_y,
    })
}

#[cfg(target_os = "windows")]
mod windows_capture {
    use super::{png_result, CaptureResult};
    use std::{ffi::c_void, mem::size_of, ptr::null_mut, slice};
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{
                BitBlt, ClientToScreen, CreateCompatibleDC, CreateDIBSection, DeleteDC,
                DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
                CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, ROP_CODE, SRCCOPY,
            },
        },
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                GetClientRect, GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect,
                IsIconic, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
                SM_YVIRTUALSCREEN, WMSZ_BOTTOM, WMSZ_BOTTOMLEFT, WMSZ_BOTTOMRIGHT, WMSZ_LEFT,
                WMSZ_RIGHT, WMSZ_TOP, WMSZ_TOPLEFT, WMSZ_TOPRIGHT, WM_MOVING, WM_NCDESTROY,
                WM_SIZING,
            },
        },
    };

    const SELECTOR_BOUNDS_SUBCLASS_ID: usize = 0x4353_4244;
    const MAX_CUSTOM_FRAME_INSET: i32 = 4;

    #[derive(Clone, Copy)]
    struct SelectorBounds {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    fn clamp_moving_rect(rect: &mut RECT, bounds: SelectorBounds) {
        let width = (rect.right - rect.left).clamp(1, bounds.right - bounds.left);
        let height = (rect.bottom - rect.top).clamp(1, bounds.bottom - bounds.top);
        rect.left = rect.left.clamp(bounds.left, bounds.right - width);
        rect.top = rect.top.clamp(bounds.top, bounds.bottom - height);
        rect.right = rect.left + width;
        rect.bottom = rect.top + height;
    }

    fn clamp_sizing_rect(rect: &mut RECT, edge: u32, bounds: SelectorBounds) {
        if matches!(edge, WMSZ_LEFT | WMSZ_TOPLEFT | WMSZ_BOTTOMLEFT) {
            rect.left = rect.left.max(bounds.left);
        }
        if matches!(edge, WMSZ_RIGHT | WMSZ_TOPRIGHT | WMSZ_BOTTOMRIGHT) {
            rect.right = rect.right.min(bounds.right);
        }
        if matches!(edge, WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT) {
            rect.top = rect.top.max(bounds.top);
        }
        if matches!(edge, WMSZ_BOTTOM | WMSZ_BOTTOMLEFT | WMSZ_BOTTOMRIGHT) {
            rect.bottom = rect.bottom.min(bounds.bottom);
        }
    }

    unsafe extern "system" fn selector_bounds_subclass(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        subclass_id: usize,
        reference_data: usize,
    ) -> LRESULT {
        let bounds = unsafe { *(reference_data as *const SelectorBounds) };
        match message {
            WM_MOVING => {
                let rect = unsafe { &mut *(lparam.0 as *mut RECT) };
                clamp_moving_rect(rect, bounds);
                return LRESULT(1);
            }
            WM_SIZING => {
                let rect = unsafe { &mut *(lparam.0 as *mut RECT) };
                clamp_sizing_rect(rect, wparam.0 as u32, bounds);
                return LRESULT(1);
            }
            WM_NCDESTROY => unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(selector_bounds_subclass), subclass_id);
                drop(Box::from_raw(reference_data as *mut SelectorBounds));
            },
            _ => {}
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub fn constrain_selector_to_desktop(hwnd: HWND) -> Result<(), String> {
        let (left, top, width, height) = virtual_bounds()?;
        let bounds = Box::new(SelectorBounds {
            left,
            top,
            right: left + width as i32,
            bottom: top + height as i32,
        });
        let reference_data = Box::into_raw(bounds) as usize;
        let installed = unsafe {
            SetWindowSubclass(
                hwnd,
                Some(selector_bounds_subclass),
                SELECTOR_BOUNDS_SUBCLASS_ID,
                reference_data,
            )
        };
        if !installed.as_bool() {
            unsafe {
                drop(Box::from_raw(reference_data as *mut SelectorBounds));
            }
            return Err("Windows could not constrain the region selector to the desktop".into());
        }
        Ok(())
    }

    struct DibCapture {
        screen_dc: windows::Win32::Graphics::Gdi::HDC,
        memory_dc: windows::Win32::Graphics::Gdi::HDC,
        bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
        previous: HGDIOBJ,
        bits: *mut c_void,
        width: i32,
        height: i32,
    }

    impl DibCapture {
        unsafe fn new(width: i32, height: i32) -> Result<Self, String> {
            if width <= 0 || height <= 0 {
                return Err("The capture area has no visible pixels".into());
            }

            let screen_dc = unsafe { GetDC(None) };
            if screen_dc.is_invalid() {
                return Err("Windows could not open the desktop drawing surface".into());
            }
            let memory_dc = unsafe { CreateCompatibleDC(Some(screen_dc)) };
            if memory_dc.is_invalid() {
                unsafe { ReleaseDC(None, screen_dc) };
                return Err("Windows could not create a capture surface".into());
            }

            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits = null_mut();
            let bitmap = unsafe {
                CreateDIBSection(Some(screen_dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
            }
            .map_err(|error| format!("Windows could not allocate the capture bitmap: {error}"))?;
            let previous = unsafe { SelectObject(memory_dc, HGDIOBJ(bitmap.0)) };

            Ok(Self {
                screen_dc,
                memory_dc,
                bitmap,
                previous,
                bits,
                width,
                height,
            })
        }

        fn pixels(&self) -> Vec<u8> {
            let byte_len = self.width as usize * self.height as usize * 4;
            unsafe { slice::from_raw_parts(self.bits.cast::<u8>(), byte_len).to_vec() }
        }

        unsafe fn copy_screen(&self, x: i32, y: i32) -> Result<(), String> {
            let raster_operation = ROP_CODE(SRCCOPY.0 | CAPTUREBLT.0);
            unsafe {
                BitBlt(
                    self.memory_dc,
                    0,
                    0,
                    self.width,
                    self.height,
                    Some(self.screen_dc),
                    x,
                    y,
                    raster_operation,
                )
            }
            .map_err(|error| format!("Windows could not copy pixels from the screen: {error}"))
        }
    }

    impl Drop for DibCapture {
        fn drop(&mut self) {
            unsafe {
                SelectObject(self.memory_dc, self.previous);
                let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
                let _ = DeleteDC(self.memory_dc);
                ReleaseDC(None, self.screen_dc);
            }
        }
    }

    fn custom_frame_client_bounds(frame: RECT, client: RECT) -> Option<RECT> {
        if client.right <= client.left || client.bottom <= client.top {
            return None;
        }

        let insets = [
            client.left - frame.left,
            client.top - frame.top,
            frame.right - client.right,
            frame.bottom - client.bottom,
        ];
        insets
            .iter()
            .all(|inset| (0..=MAX_CUSTOM_FRAME_INSET).contains(inset))
            .then_some(client)
    }

    unsafe fn active_window_bounds(window: HWND) -> Result<RECT, String> {
        let mut frame = RECT::default();
        if unsafe {
            DwmGetWindowAttribute(
                window,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&mut frame as *mut RECT).cast(),
                size_of::<RECT>() as u32,
            )
        }
        .is_err()
        {
            unsafe { GetWindowRect(window, &mut frame) }
                .map_err(|error| format!("Could not read the active window bounds: {error}"))?;
        }

        // Custom-framed windows commonly leave a one-pixel DWM border around a
        // client surface that otherwise reaches every edge. Capturing the DWM
        // rectangle copies that translucent fringe from the composed desktop.
        // A normally decorated window has a much larger top inset for its native
        // title bar, so retain the full frame in that case.
        let mut client = RECT::default();
        if unsafe { GetClientRect(window, &mut client) }.is_ok() {
            let client_width = client.right - client.left;
            let client_height = client.bottom - client.top;
            let mut origin = POINT {
                x: client.left,
                y: client.top,
            };
            if unsafe { ClientToScreen(window, &mut origin) }.as_bool() {
                let client_screen = RECT {
                    left: origin.x,
                    top: origin.y,
                    right: origin.x + client_width,
                    bottom: origin.y + client_height,
                };
                if let Some(bounds) = custom_frame_client_bounds(frame, client_screen) {
                    return Ok(bounds);
                }
            }
        }

        Ok(frame)
    }

    pub fn active_window() -> Result<CaptureResult, String> {
        unsafe {
            let window = GetForegroundWindow();
            if window == HWND::default() {
                return Err("No foreground window is available to capture".into());
            }
            if IsIconic(window).as_bool() {
                return Err("The active window is minimized".into());
            }

            let bounds = active_window_bounds(window)?;

            let width = bounds.right - bounds.left;
            let height = bounds.bottom - bounds.top;
            let surface = DibCapture::new(width, height)?;
            surface.copy_screen(bounds.left, bounds.top)?;

            png_result(
                surface.pixels(),
                width as u32,
                height as u32,
                bounds.left,
                bounds.top,
            )
        }
    }

    pub fn virtual_bounds() -> Result<(i32, i32, u32, u32), String> {
        unsafe {
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if width <= 0 || height <= 0 {
                return Err("Windows reported an invalid virtual desktop size".into());
            }
            Ok((x, y, width as u32, height as u32))
        }
    }

    pub fn initial_selector_bounds(
        preferred_width: Option<u32>,
        preferred_height: Option<u32>,
        preferred_x: Option<i32>,
        preferred_y: Option<i32>,
    ) -> Result<(i32, i32, u32, u32), String> {
        let (desktop_x, desktop_y, desktop_width, desktop_height) = virtual_bounds()?;
        let minimum_width = desktop_width.min(240);
        let minimum_height = desktop_height.min(160);
        let width = preferred_width
            .filter(|width| *width > 0)
            .unwrap_or(900)
            .clamp(minimum_width, desktop_width);
        let height = preferred_height
            .filter(|height| *height > 0)
            .unwrap_or(520)
            .clamp(minimum_height, desktop_height);
        let mut cursor = windows::Win32::Foundation::POINT::default();
        unsafe {
            GetCursorPos(&mut cursor)
                .map_err(|error| format!("Could not read the pointer position: {error}"))?;
        }
        let maximum_x = desktop_x + desktop_width as i32 - width as i32;
        let maximum_y = desktop_y + desktop_height as i32 - height as i32;
        let (requested_x, requested_y) = match (preferred_x, preferred_y) {
            (Some(x), Some(y)) => (x, y),
            _ => (cursor.x - width as i32 / 2, cursor.y - height as i32 / 2),
        };
        let x = requested_x.clamp(desktop_x, maximum_x);
        let y = requested_y.clamp(desktop_y, maximum_y);
        Ok((x, y, width, height))
    }

    pub fn screen_region(
        local_x: u32,
        local_y: u32,
        width: u32,
        height: u32,
    ) -> Result<CaptureResult, String> {
        let (desktop_x, desktop_y, desktop_width, desktop_height) = virtual_bounds()?;
        if width == 0
            || height == 0
            || local_x > desktop_width
            || local_y > desktop_height
            || width > desktop_width.saturating_sub(local_x)
            || height > desktop_height.saturating_sub(local_y)
        {
            return Err("The selected region is outside the visible desktop".into());
        }

        let origin_x = desktop_x
            .checked_add(local_x as i32)
            .ok_or_else(|| "The selected region has an invalid horizontal position".to_string())?;
        let origin_y = desktop_y
            .checked_add(local_y as i32)
            .ok_or_else(|| "The selected region has an invalid vertical position".to_string())?;
        unsafe {
            let surface = DibCapture::new(width as i32, height as i32)?;
            surface.copy_screen(origin_x, origin_y)?;
            png_result(surface.pixels(), width, height, origin_x, origin_y)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::custom_frame_client_bounds;
        use windows::Win32::Foundation::RECT;

        #[test]
        fn uses_client_surface_for_a_thin_custom_frame() {
            let frame = RECT {
                left: 2308,
                top: 574,
                right: 3642,
                bottom: 1512,
            };
            let client = RECT {
                left: 2309,
                top: 575,
                right: 3641,
                bottom: 1511,
            };

            assert_eq!(custom_frame_client_bounds(frame, client), Some(client));
        }

        #[test]
        fn keeps_native_title_bar_in_the_capture() {
            let frame = RECT {
                left: 100,
                top: 100,
                right: 1100,
                bottom: 800,
            };
            let client = RECT {
                left: 101,
                top: 132,
                right: 1099,
                bottom: 799,
            };

            assert_eq!(custom_frame_client_bounds(frame, client), None);
        }
    }
}
