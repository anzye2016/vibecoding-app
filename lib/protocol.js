/* ── Wire protocol between the phone app and the PC client ──
 * Canonical message-type strings shared by app/ and client/ so the two
 * runtimes cannot silently drift (a typo on one side = silent breakage).
 *
 * App-internal message types (user/spacer/history-*) and the opencode
 * `--format json` stream types (text/reasoning/tool_use) are intentionally
 * NOT part of this contract.
 */
export const P = {
  // app -> client
  MSG: "msg",
  CANCEL: "cancel",
  LOAD_HISTORY: "load_history",
  LIST_SESSIONS: "list_sessions",
  SELECT_SESSION: "select_session",
  STATUS_QUERY: "status_query",
  // client -> app
  CHUNK: "chunk",
  DONE: "done",
  CANCELLED: "cancelled",
  ERROR: "error",
  CLEAR_PROCESSING: "clear_processing",
  PROCESSING: "processing",
  PROCESSING_STATE: "processing_state",
  HISTORY: "history",
  SESSIONS: "sessions",
  STATUS: "status",
};
