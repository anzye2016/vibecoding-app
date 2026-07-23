"""compact.py — Open terminal, run opencode, send /compact, wait, close.

Uses clipboard paste (pyperclip + pyautogui) for reliable text input.
Closes gracefully via /exit -> exit -> exit (no process killing)."""

import sys
import json
import time
import ctypes
import ctypes.wintypes
import subprocess
import argparse
import uuid

user32 = ctypes.windll.user32

# ---------------------------------------------------------------------------
# Window finding (ctypes + EnumWindows — works for all window classes)
# ---------------------------------------------------------------------------
_found_hwnd = 0
_search_title = ""

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)


@WNDENUMPROC
def _enum_callback(hwnd, lparam):
    global _found_hwnd
    if not user32.IsWindowVisible(hwnd):
        return True
    if _search_title:
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        if _search_title in buf.value:
            _found_hwnd = hwnd
            return False
    return True


def find_window(title):
    global _found_hwnd, _search_title
    _found_hwnd = 0
    _search_title = title
    user32.EnumWindows(_enum_callback, 0)
    return _found_hwnd


def focus_window(hwnd, retries=3):
    if not hwnd:
        return False
    for _ in range(retries):
        fg = user32.GetForegroundWindow()
        fg_tid = user32.GetWindowThreadProcessId(fg, None)
        our_tid = user32.GetWindowThreadProcessId(hwnd, None)
        if fg_tid != our_tid:
            user32.AttachThreadInput(our_tid, fg_tid, True)
        user32.BringWindowToTop(hwnd)
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.AllowSetForegroundWindow(-1)
        user32.SetForegroundWindow(hwnd)
        if fg_tid != our_tid:
            user32.AttachThreadInput(our_tid, fg_tid, False)
        time.sleep(0.3)
        if user32.GetForegroundWindow() == hwnd:
            return True
    return False


# ---------------------------------------------------------------------------
# Keyboard input via clipboard paste
# ---------------------------------------------------------------------------
def type_line(text):
    import pyperclip
    import pyautogui

    old = pyperclip.paste()
    try:
        pyperclip.copy(text)
        time.sleep(0.05)
        pyautogui.hotkey("ctrl", "v")
        time.sleep(0.1)
        pyautogui.press("enter")
        time.sleep(0.3)
    finally:
        try:
            pyperclip.copy(old)
        except Exception:
            pass


# ---------------------------------------------------------------------------
def close_terminal(hwnd, mode):
    """Graceful close: /exit opencode, exit shell(s), no process killing."""
    if not hwnd or not user32.IsWindow(hwnd):
        return

    if not focus_window(hwnd):
        print("[compact] Focus failed, trying anyway...", file=sys.stderr)

    time.sleep(0.3)

    # Exit opencode
    type_line("/exit")
    time.sleep(2)

    if not user32.IsWindow(hwnd):
        return

    # Exit shell
    if not focus_window(hwnd):
        print("[compact] Focus failed at exit 1, trying anyway...", file=sys.stderr)
    type_line("exit")
    time.sleep(1.5)

    # WSL mode: one more exit (WSL bash -> PS -> close)
    if mode == "wsl" and user32.IsWindow(hwnd):
        if not focus_window(hwnd):
            print("[compact] Focus failed at exit 2, trying anyway...", file=sys.stderr)
        type_line("exit")
        time.sleep(1.5)

    # Fallback: WM_CLOSE
    if user32.IsWindow(hwnd):
        user32.PostMessageW(hwnd, 0x0010, 0, 0)


# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--session", required=True)
    parser.add_argument("--mode", choices=["win", "wsl"], required=True)
    parser.add_argument("--opencode", default="opencode")
    parser.add_argument("--startup-wait", type=int, default=30)
    parser.add_argument("--compact-wait", type=int, default=60)
    args = parser.parse_args()

    try:
        import pyperclip, pyautogui  # noqa: F401
    except ImportError as e:
        print(json.dumps({"success": False, "message": f"Missing dependency: {e}"}))
        sys.exit(1)

    unique_id = "VBCOMP-" + str(uuid.uuid4())[:8]
    hwnd = 0

    try:
        # 1. Launch terminal
        title_cmd = f"$Host.UI.RawUI.WindowTitle='{unique_id}'"
        if args.mode == "wsl":
            cmd = f'start "" powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -Command "{title_cmd}; wsl"'
        else:
            cmd = f'start "" powershell.exe -NoLogo -NoExit -ExecutionPolicy Bypass -Command "{title_cmd}"'
        subprocess.Popen(
            cmd,
            shell=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print(f"[compact] Launched, title={unique_id}", file=sys.stderr)

        # 2. Find by unique title
        time.sleep(2)
        for _ in range(20):
            hwnd = find_window(unique_id)
            if hwnd:
                break
            time.sleep(0.5)

        if not hwnd:
            raise RuntimeError(f"Terminal window not found (title={unique_id})")

        print(f"[compact] Window hwnd={hwnd}", file=sys.stderr)

        # 3. Focus
        if not focus_window(hwnd):
            print("[compact] Warning: initial focus failed", file=sys.stderr)
        time.sleep(0.5)

        # 4. cd (belt-and-suspenders: terminal may not start in target dir)
        focus_window(hwnd)
        type_line(f'cd "{args.dir}"')
        time.sleep(0.5)

        # 5. opencode
        oc_cmd = f"{args.opencode} -s {args.session}"
        print(f"[compact] {oc_cmd}", file=sys.stderr)
        focus_window(hwnd)
        type_line(oc_cmd)

        # 6. Wait for opencode TUI
        print(f"[compact] Wait {args.startup_wait}s for opencode...", file=sys.stderr)
        time.sleep(args.startup_wait)

        # 7. /compact
        print("[compact] Sending /compact", file=sys.stderr)
        focus_window(hwnd)
        type_line("/compact")

        # 8. Wait
        print(f"[compact] Wait {args.compact_wait}s...", file=sys.stderr)
        time.sleep(args.compact_wait)

        # 9. Close gracefully
        print("[compact] Closing terminal", file=sys.stderr)
        close_terminal(hwnd, args.mode)

        print(json.dumps({"success": True, "message": "Compact completed"}))

    except Exception as e:
        if hwnd:
            try:
                close_terminal(hwnd, args.mode)
            except Exception:
                pass

        print(json.dumps({"success": False, "message": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
