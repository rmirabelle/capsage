use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::GenericImageView;
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const DOCUMENT_FORMAT: &str = "capsage-document";
const DOCUMENT_VERSION: u64 = 1;
const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedCaptureFile {
    kind: &'static str,
    data_url: String,
    width: u32,
    height: u32,
    origin_x: i32,
    origin_y: i32,
    manifest_json: Option<String>,
}

fn image_details(bytes: &[u8]) -> Result<(&'static str, &'static str, u32, u32), String> {
    let format = image::guess_format(bytes)
        .map_err(|_| "The selected file is not a supported PNG or JPEG image".to_string())?;
    let (mime_type, extension) = match format {
        image::ImageFormat::Png => ("image/png", "png"),
        image::ImageFormat::Jpeg => ("image/jpeg", "jpg"),
        _ => return Err("CapSage can open PNG and JPEG images".into()),
    };
    let decoded = image::load_from_memory_with_format(bytes, format)
        .map_err(|error| format!("Could not decode the selected image: {error}"))?;
    let (width, height) = decoded.dimensions();
    if width == 0 || height == 0 {
        return Err("The selected image has no visible pixels".into());
    }
    Ok((mime_type, extension, width, height))
}

fn read_limited(entry: &mut zip::read::ZipFile<'_>, maximum: u64) -> Result<Vec<u8>, String> {
    if entry.size() > maximum {
        return Err(format!("{} is too large to open safely", entry.name()));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read {}: {error}", entry.name()))?;
    Ok(bytes)
}

fn validate_manifest(manifest: &Value) -> Result<(), String> {
    if manifest.get("format").and_then(Value::as_str) != Some(DOCUMENT_FORMAT) {
        return Err("This is not a CapSage document".into());
    }
    let version = manifest
        .get("formatVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| "The CapSage document has no valid format version".to_string())?;
    if version != DOCUMENT_VERSION {
        return Err(format!(
            "This CapSage document uses unsupported format version {version}"
        ));
    }
    Ok(())
}

fn open_document(path: &Path) -> Result<OpenedCaptureFile, String> {
    let file = File::open(path).map_err(|error| format!("Could not open the document: {error}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("Could not read the CapSage document: {error}"))?;

    let manifest_bytes = {
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| "The CapSage document is missing manifest.json".to_string())?;
        read_limited(&mut entry, MAX_MANIFEST_BYTES)?
    };
    let manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("The CapSage document manifest is invalid: {error}"))?;
    validate_manifest(&manifest)?;

    let image = manifest
        .get("image")
        .and_then(Value::as_object)
        .ok_or_else(|| "The CapSage document has no image metadata".to_string())?;
    let image_path = image
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| "The CapSage document has no embedded image path".to_string())?;
    if image_path != "image.png" && image_path != "image.jpg" {
        return Err("The CapSage document references an unsupported image entry".into());
    }
    let image_bytes = {
        let mut entry = archive
            .by_name(image_path)
            .map_err(|_| "The CapSage document is missing its embedded image".to_string())?;
        read_limited(&mut entry, MAX_IMAGE_BYTES)?
    };
    let (mime_type, _, width, height) = image_details(&image_bytes)?;
    let origin_x = image.get("originX").and_then(Value::as_i64).unwrap_or(0) as i32;
    let origin_y = image.get("originY").and_then(Value::as_i64).unwrap_or(0) as i32;
    let manifest_json = serde_json::to_string(&manifest)
        .map_err(|error| format!("Could not restore the CapSage document manifest: {error}"))?;

    Ok(OpenedCaptureFile {
        kind: "document",
        data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(image_bytes)),
        width,
        height,
        origin_x,
        origin_y,
        manifest_json: Some(manifest_json),
    })
}

fn open_image(path: &Path) -> Result<OpenedCaptureFile, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Could not inspect the selected image: {error}"))?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("The selected image is too large to open safely".into());
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Could not read the selected image: {error}"))?;
    let (mime_type, _, width, height) = image_details(&bytes)?;
    Ok(OpenedCaptureFile {
        kind: "image",
        data_url: format!("data:{mime_type};base64,{}", STANDARD.encode(bytes)),
        width,
        height,
        origin_x: 0,
        origin_y: 0,
        manifest_json: None,
    })
}

#[tauri::command]
pub fn open_capture_file(path: String) -> Result<OpenedCaptureFile, String> {
    let path = Path::new(&path);
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("capsage"))
    {
        open_document(path)
    } else {
        open_image(path)
    }
}

#[tauri::command]
pub fn save_capsage_document(
    path: String,
    manifest_json: String,
    data_url: String,
) -> Result<(), String> {
    let mut manifest: Value = serde_json::from_str(&manifest_json)
        .map_err(|error| format!("Could not serialize the CapSage document: {error}"))?;
    validate_manifest(&manifest)?;

    let (prefix, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "The document image is invalid".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|error| format!("Could not decode the document image: {error}"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("The document image is too large to save safely".into());
    }
    let (mime_type, extension, width, height) = image_details(&bytes)?;
    if !prefix.eq_ignore_ascii_case(&format!("data:{mime_type};base64")) {
        return Err("The document image type does not match its contents".into());
    }
    let image_path = format!("image.{extension}");
    let image = manifest
        .get_mut("image")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The CapSage document has no image metadata".to_string())?;
    image.insert("path".into(), Value::String(image_path.clone()));
    image.insert("mimeType".into(), Value::String(mime_type.into()));
    image.insert("width".into(), Value::from(width));
    image.insert("height".into(), Value::from(height));

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("Could not serialize the CapSage document: {error}"))?;
    let file = File::create(&path)
        .map_err(|error| format!("Could not create the CapSage document: {error}"))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    archive
        .start_file("manifest.json", options)
        .map_err(|error| format!("Could not write the document manifest: {error}"))?;
    archive
        .write_all(&manifest_bytes)
        .map_err(|error| format!("Could not write the document manifest: {error}"))?;
    archive
        .start_file(&image_path, options)
        .map_err(|error| format!("Could not write the document image: {error}"))?;
    archive
        .write_all(&bytes)
        .map_err(|error| format!("Could not write the document image: {error}"))?;
    archive
        .finish()
        .map_err(|error| format!("Could not finish the CapSage document: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_PIXEL_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    #[test]
    fn capsage_document_round_trip_preserves_manifest_and_image() {
        let path = std::env::temp_dir().join(format!(
            "capsage-document-test-{}-{}.capsage",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let manifest = serde_json::json!({
            "format": DOCUMENT_FORMAT,
            "formatVersion": DOCUMENT_VERSION,
            "createdAt": "2026-08-31T00:00:00.000Z",
            "modifiedAt": "2026-08-31T00:00:00.000Z",
            "image": {
                "path": "image.png",
                "mimeType": "image/png",
                "width": 1,
                "height": 1,
                "originX": 17,
                "originY": -9
            },
            "captureStyle": {},
            "callouts": [{ "id": "callout-1" }],
            "focusRegions": [{ "id": "focus-1" }]
        });

        save_capsage_document(
            path.to_string_lossy().into_owned(),
            manifest.to_string(),
            format!("data:image/png;base64,{ONE_PIXEL_PNG}"),
        )
        .unwrap();

        let opened = open_capture_file(path.to_string_lossy().into_owned()).unwrap();
        assert_eq!(opened.kind, "document");
        assert_eq!((opened.width, opened.height), (1, 1));
        assert_eq!((opened.origin_x, opened.origin_y), (17, -9));
        let restored: Value =
            serde_json::from_str(opened.manifest_json.as_deref().unwrap()).unwrap();
        assert_eq!(restored["callouts"][0]["id"], "callout-1");
        assert_eq!(restored["focusRegions"][0]["id"], "focus-1");

        std::fs::remove_file(path).unwrap();
    }
}
