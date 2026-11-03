#pragma once
#include <pebble.h>

// Watch UI strings. To add one: an id here and a text for every language in i18n.c.
typedef enum {
  STR_CONNECTING,
  STR_BROKEN_LAYOUT,
  STR_NO_DICTATION,
  STR_NO_MIC,
  STR_TOUCH_OFF,
  STR_COUNT,
} StrId;

// Reads the saved language setting and picks the UI language. Call before drawing anything.
void i18n_init(void);
// Applies the language setting sent by the phone ("auto", "fr", ...).
// Returns true if the UI language changed.
bool i18n_set(const char *setting);
// Languages the system font can draw, one bit per language (order of LANG_CODES in i18n.c).
uint16_t i18n_drawable(void);
const char *i18n_str(StrId id);

#define _(id) i18n_str(id)
