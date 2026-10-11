//! Keyboard-layout-aware glyph for the capture shortcut DISPLAY.
//!
//! The global shortcut is bound by physical key code (`Code::KeyM`), so it fires
//! on any layout — on a French AZERTY the physical "M" position is the `,` key,
//! so AZERTY users press ⌃⌘, while QWERTY users press ⌃⌘M for the exact same
//! binding. Only the label we *show* needs to match the layout. This asks macOS
//! Text Input Services what character the physical M key (ANSI keycode 0x2E)
//! produces under the current layout, via `UCKeyTranslate`.

/// Virtual keycode of the physical "M" key (kVK_ANSI_M) — the capture default.
#[cfg(target_os = "macos")]
const KVK_ANSI_M: u16 = 0x2E;

#[cfg(target_os = "macos")]
mod ffi {
    use std::os::raw::{c_ulong, c_void};

    pub type CFTypeRef = *const c_void;
    pub type CFStringRef = *const c_void;
    pub type CFDataRef = *const c_void;

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        pub fn TISCopyCurrentKeyboardLayoutInputSource() -> CFTypeRef;
        pub fn TISGetInputSourceProperty(
            input_source: CFTypeRef,
            property_key: CFStringRef,
        ) -> CFDataRef;
        pub fn LMGetKbdType() -> u8;
        #[allow(non_upper_case_globals)]
        pub static kTISPropertyUnicodeKeyLayoutData: CFStringRef;
        pub fn UCKeyTranslate(
            key_layout_ptr: *const u8,
            virtual_key_code: u16,
            key_action: u16,
            modifier_key_state: u32,
            keyboard_type: u32,
            key_translate_options: u32,
            dead_key_state: *mut u32,
            max_string_length: c_ulong,
            actual_string_length: *mut c_ulong,
            unicode_string: *mut u16,
        ) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        pub fn CFDataGetBytePtr(data: CFDataRef) -> *const u8;
        pub fn CFRelease(cf: CFTypeRef);
    }
}

/// The character the physical "M" key produces under the current layout,
/// uppercased ("M" on QWERTY, "," on AZERTY). `None` off macOS or on any failure
/// (the caller then falls back to the plain key letter).
#[cfg(target_os = "macos")]
pub fn capture_key_glyph() -> Option<String> {
    use ffi::*;
    use std::os::raw::c_ulong;

    const K_UC_KEY_ACTION_DOWN: u16 = 0;
    // kUCKeyTranslateNoDeadKeysMask (bit 0) — don't fold dead keys into state.
    const K_UC_KEY_TRANSLATE_NO_DEAD_KEYS_MASK: u32 = 1;

    unsafe {
        let source = TISCopyCurrentKeyboardLayoutInputSource();
        if source.is_null() {
            return None;
        }
        // `TISGetInputSourceProperty` returns a *borrowed* reference — don't release it.
        let layout_data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
        if layout_data.is_null() {
            CFRelease(source);
            return None;
        }
        let layout_ptr = CFDataGetBytePtr(layout_data);
        if layout_ptr.is_null() {
            CFRelease(source);
            return None;
        }
        let keyboard_type = LMGetKbdType() as u32;
        let mut dead_key_state: u32 = 0;
        let mut buf = [0u16; 4];
        let mut len: c_ulong = 0;
        let status = UCKeyTranslate(
            layout_ptr,
            KVK_ANSI_M,
            K_UC_KEY_ACTION_DOWN,
            0,
            keyboard_type,
            K_UC_KEY_TRANSLATE_NO_DEAD_KEYS_MASK,
            &mut dead_key_state,
            buf.len() as c_ulong,
            &mut len,
            buf.as_mut_ptr(),
        );
        CFRelease(source);
        if status != 0 || len == 0 {
            return None;
        }
        let s = String::from_utf16_lossy(&buf[..len as usize]);
        let s = s.trim().to_uppercase();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn capture_key_glyph() -> Option<String> {
    None
}
