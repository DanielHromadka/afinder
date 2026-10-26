// aFinder's input helper: replays the mouse and keyboard of a remote desktop viewer on this computer.
// aFinder (src/main/services/inputInjector.ts) starts it for a control session and writes one JSON command
// per line to stdin; the helper answers once on stdout ({"ok":true} or {"error":"…"}) and then only acts.
// Everything it holds down is released on {"t":"release"} and when stdin closes, so a dropped session
// never leaves a key or button stuck.

use std::collections::HashSet;
use std::io::{self, BufRead, Write};

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, NewConError, Settings};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
enum Command {
    Move { x: i32, y: i32 },
    Button { b: String, d: bool },
    Scroll { x: i32, y: i32 },
    /// A named key (`k`, see `named`) or a character key (`c`).
    Key { k: Option<String>, c: Option<char>, d: bool },
    Text { s: String },
    Release,
}

fn named(name: &str) -> Option<Key> {
    Some(match name {
        "Return" => Key::Return,
        "Escape" => Key::Escape,
        "Tab" => Key::Tab,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "Space" => Key::Space,
        "Up" => Key::UpArrow,
        "Down" => Key::DownArrow,
        "Left" => Key::LeftArrow,
        "Right" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "CapsLock" => Key::CapsLock,
        "Shift" => Key::Shift,
        "RShift" => Key::RShift,
        "Control" => Key::Control,
        "RControl" => Key::RControl,
        "Alt" => Key::Alt,
        "Meta" => Key::Meta,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        #[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
        "Insert" => Key::Insert,
        _ => return None,
    })
}

fn button(name: &str) -> Option<Button> {
    match name {
        "left" => Some(Button::Left),
        "right" => Some(Button::Right),
        "middle" => Some(Button::Middle),
        _ => None,
    }
}

const fn dir(down: bool) -> Direction {
    if down { Direction::Press } else { Direction::Release }
}

struct Held {
    keys: HashSet<Key>,
    buttons: Vec<Button>,
}

impl Held {
    fn release(&mut self, enigo: &mut Enigo) {
        for k in self.keys.drain() {
            let _ = enigo.key(k, Direction::Release);
        }
        for b in self.buttons.drain(..) {
            let _ = enigo.button(b, Direction::Release);
        }
    }
}

fn run(enigo: &mut Enigo, held: &mut Held, cmd: Command) -> enigo::InputResult<()> {
    match cmd {
        Command::Move { x, y } => enigo.move_mouse(x, y, Coordinate::Abs),
        Command::Button { b, d } => {
            let Some(b) = button(&b) else { return Ok(()) };
            if d {
                if !held.buttons.contains(&b) {
                    held.buttons.push(b)
                }
            } else {
                held.buttons.retain(|x| *x != b)
            }
            enigo.button(b, dir(d))
        }
        Command::Scroll { x, y } => {
            if y != 0 {
                enigo.scroll(y, Axis::Vertical)?
            }
            if x != 0 {
                enigo.scroll(x, Axis::Horizontal)?
            }
            Ok(())
        }
        Command::Key { k, c, d } => {
            let key = match (k.as_deref().and_then(named), c) {
                (Some(key), _) => key,
                (None, Some(c)) => Key::Unicode(c),
                _ => return Ok(()),
            };
            if d { held.keys.insert(key) } else { held.keys.remove(&key) };
            enigo.key(key, dir(d))
        }
        Command::Text { s } => enigo.text(&s),
        Command::Release => Ok(held.release(enigo)),
    }
}

fn main() {
    let mut out = io::stdout();
    let settings = Settings { release_keys_when_dropped: true, ..Default::default() };
    let mut enigo = match Enigo::new(&settings) {
        Ok(e) => e,
        Err(err) => {
            let code = if matches!(err, NewConError::NoPermission) { "permission".to_string() } else { err.to_string() };
            let _ = writeln!(out, "{}", serde_json::json!({ "error": code }));
            std::process::exit(2);
        }
    };
    let _ = writeln!(out, "{{\"ok\":true}}");
    let _ = out.flush();
    let mut held = Held { keys: HashSet::new(), buttons: Vec::new() };
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        // Bad lines and failed events are skipped: one lost event must not end the session.
        if let Ok(cmd) = serde_json::from_str::<Command>(&line) {
            if let Err(err) = run(&mut enigo, &mut held, cmd) {
                eprintln!("{err}");
            }
        }
    }
    held.release(&mut enigo);
}
