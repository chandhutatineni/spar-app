//! SF Symbols, drawn by macOS itself, so every icon is the one the Mac app shows.
//! `sf_symbol {name, size, weight?, scale?}` → {png (base64), width, height} (points).
//! The PNG is a black template; the UI uses it as a CSS mask so it takes the text colour.
//! Other platforms return an error and the UI falls back to its own icon set.

use crate::registry::{parse, Registry};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
struct Args {
    name: String,
    size: f64,
    #[serde(default)]
    weight: Option<String>,
    #[serde(default)]
    scale: Option<f64>,
}

#[cfg(target_os = "macos")]
fn render(a: &Args) -> Result<Value, String> {
    use base64::Engine as _;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::{NSData, NSDictionary, NSPoint, NSRect, NSSize, NSString};

    let scale = a.scale.unwrap_or(2.0).clamp(1.0, 4.0);
    // NSFontWeight values
    let weight = match a.weight.as_deref().unwrap_or("regular") {
        "ultralight" => -0.8,
        "thin" => -0.6,
        "light" => -0.4,
        "medium" => 0.23,
        "semibold" => 0.3,
        "bold" => 0.4,
        "heavy" => 0.56,
        "black" => 0.62,
        _ => 0.0,
    };
    unsafe {
        let name = NSString::from_str(&a.name);
        let img: Option<Retained<AnyObject>> =
            msg_send![class!(NSImage), imageWithSystemSymbolName: &*name, accessibilityDescription: std::ptr::null::<NSString>()];
        let img = img.ok_or_else(|| format!("no SF Symbol named {}", a.name))?;
        // Configure at the display size × scale so the bitmap is sharp on Retina.
        let cfg: Retained<AnyObject> =
            msg_send![class!(NSImageSymbolConfiguration), configurationWithPointSize: a.size * scale, weight: weight as f64];
        let img: Option<Retained<AnyObject>> = msg_send![&*img, imageWithSymbolConfiguration: &*cfg];
        let img = img.ok_or("could not configure the symbol")?;
        let size: NSSize = msg_send![&*img, size];
        let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), size);
        let cg: *mut std::ffi::c_void =
            msg_send![&*img, CGImageForProposedRect: &mut rect, context: std::ptr::null::<AnyObject>(), hints: std::ptr::null::<AnyObject>()];
        if cg.is_null() {
            return Err("could not draw the symbol".into());
        }
        let rep: Allocated<AnyObject> = msg_send![class!(NSBitmapImageRep), alloc];
        let rep: Option<Retained<AnyObject>> = msg_send![rep, initWithCGImage: cg];
        let rep = rep.ok_or("could not wrap the symbol bitmap")?;
        let props = NSDictionary::<NSString, AnyObject>::new();
        // NSBitmapImageFileTypePNG = 4
        let data: Option<Retained<NSData>> = msg_send![&*rep, representationUsingType: 4usize, properties: &*props];
        let data = data.ok_or("could not encode the symbol")?;
        let png = base64::engine::general_purpose::STANDARD.encode(data.to_vec());
        Ok(json!({"png": png, "width": size.width / scale, "height": size.height / scale}))
    }
}

#[cfg(not(target_os = "macos"))]
fn render(_a: &Args) -> Result<Value, String> {
    Err("SF Symbols are only available on macOS".into())
}

pub fn register(r: &mut Registry) {
    r.add("sf_symbol", |a| {
        let a: Args = parse(a)?;
        render(&a)
    });
}
