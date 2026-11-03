// AppMessage protocol between the watch and PebbleKit JS. Keep in sync with src/c/protocol.h.
'use strict';

module.exports = {
  // watch -> phone
  // HELLO: value = flags: bit 0 has_backup, bits 1.. languages the watch can draw (bit 1 + i = i18n.LANGS[i]);
  // text = the watch's system locale (e.g. fr_FR)
  CMD_HELLO: 1, // hash, screen_w, screen_h, shape, inbox_size, persist_max, value, text, backup_hash, page
  CMD_EVENT: 2, // page, elem, part, gesture, value, [text]
  CMD_PAGE_SHOWN: 3, // page
  CMD_BACKUP_DATA: 4, // offset, total, data (total=0: no backup)

  // phone -> watch
  CMD_PHONE_READY: 10, // hash
  CMD_LAYOUT_BEGIN: 11, // total, hash
  CMD_LAYOUT_CHUNK: 12, // offset, data
  CMD_LAYOUT_END: 13, // hash
  CMD_TOAST: 14, // text, value=kind
  CMD_VALUE: 15, // page, elem, value (0..255)
  CMD_GOTO: 16, // page
  CMD_DICTATE: 17, // page, elem, part, [text=prompt]
  CMD_BACKUP_BEGIN: 18, // total, hash
  CMD_BACKUP_CHUNK: 19, // offset, data
  CMD_BACKUP_END: 20, //
  CMD_BACKUP_REQUEST: 21, //
  CMD_LANG: 22, // text = language setting: auto or a code from i18n.LANGS

  TOAST_INFO: 0,
  TOAST_OK: 1,
  TOAST_ERROR: 2,

  ELEM_SELECT: 240,
  ELEM_UP: 241,
  ELEM_DOWN: 242,
};
