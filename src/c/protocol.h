#pragma once
// AppMessage protocol. Keep in sync with src/pkjs/lib/protocol.js and src/pkjs/lib/actions.js.

// watch -> phone
#define CMD_HELLO 1  // value: bit 0 has backup, bit 1 + i language i can be drawn; text: locale
#define CMD_EVENT 2
#define CMD_PAGE_SHOWN 3
#define CMD_BACKUP_DATA 4

// phone -> watch
#define CMD_PHONE_READY 10
#define CMD_LAYOUT_BEGIN 11
#define CMD_LAYOUT_CHUNK 12
#define CMD_LAYOUT_END 13
#define CMD_TOAST 14
#define CMD_VALUE 15
#define CMD_GOTO 16
#define CMD_DICTATE 17
#define CMD_BACKUP_BEGIN 18
#define CMD_BACKUP_CHUNK 19
#define CMD_BACKUP_END 20
#define CMD_BACKUP_REQUEST 21
#define CMD_LANG 22  // text: language setting ("auto", "fr", ...)

#define TOAST_INFO 0
#define TOAST_OK 1
#define TOAST_ERROR 2

// Gestures sent with CMD_EVENT
#define G_TAP 0
#define G_HOLD 1
#define G_DOUBLE 2
#define G_REPEAT 3
#define G_SLIDE 4
#define G_DRAG 5
#define G_ROTATE 6
#define G_TEXT 7

// Element parts
#define PART_CENTER 0
#define PART_UP 1
#define PART_DOWN 2
#define PART_LEFT 3
#define PART_RIGHT 4

// Pseudo element ids for the hardware buttons
#define ELEM_SELECT 240
#define ELEM_UP 241
#define ELEM_DOWN 242
