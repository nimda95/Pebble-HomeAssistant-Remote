#pragma once
#include <pebble.h>

// Element types
#define EL_BUTTON 1
#define EL_TOUCHPAD 2
#define EL_CIRCLEPAD 3
#define EL_SLIDER 4

// Element flags
#define ELF_VERTICAL 1
#define ELF_DRAG 2
#define ELF_LABEL 4
#define ELF_VALUE 8     // slider value known
#define ELF_PERCENT 16  // slider shows a percentage instead of its value

// Part flags
#define PF_TAP 1
#define PF_HOLD 2
#define PF_REPEAT 4
#define PF_DOUBLE 8
#define PF_LOCAL_NEXT 16
#define PF_LOCAL_PREV 32

// Header flags
#define HDR_ROUND 4

// Page flags
#define PG_HAPTICS 1
#define PG_TITLE 2

#define NO_ICON 255
#define NUM_PARTS 5

typedef struct {
  uint8_t id;      // element index in the phone's model, sent back with events
  uint8_t type;
  uint8_t flags;
  GRect rect;
  uint8_t fg, bg;  // GColor8 argb, 0 = theme default
  uint8_t value;   // slider position 0..255
  uint16_t hold_ms, repeat_ms, double_ms;
  uint8_t pf[NUM_PARTS];
  uint8_t icon[NUM_PARTS];
  const char *label;
  // sliders: value range in thousandths, decimals to show, unit
  int32_t min, max, step;
  uint8_t decimals;
  const char *unit;
} Elem;

typedef struct {
  const char *name;
  uint8_t count;
  uint8_t flags;  // PG_*
  GColor bg, btn_bg, btn_fg, accent, title_fg, pad_bg;
  uint16_t hold_ms, repeat_ms, double_ms;
  uint8_t buttons[3];  // part flags of select, up, down
  Elem *elems;
} Page;

typedef struct {
  uint8_t *blob;
  uint32_t len;
  uint32_t hash;
  uint8_t flags;  // HDR_*
  uint8_t num_pages;
  uint8_t num_icons;
  uint8_t start_page;
  Page *pages;
  GBitmap **icons;
  GColor *palettes;  // 4 entries per icon
} Layout;

// Parses a blob (takes ownership of it). Returns NULL if it is malformed.
Layout *layout_parse(uint8_t *blob, uint32_t len, uint32_t hash);
void layout_destroy(Layout *l);

// Icon bitmap tinted with `color` (alpha levels are kept). NULL if none.
GBitmap *layout_icon(Layout *l, uint8_t index, GColor color);

// Persistent storage
Layout *layout_load(void);
void layout_save(const Layout *l);
uint32_t layout_saved_hash(void);

// Opaque phone backup (settings + config) kept on the watch.
bool backup_exists(void);
uint32_t backup_size(void);
uint32_t backup_read(uint32_t offset, uint8_t *dst, uint32_t len);
void backup_save(const uint8_t *data, uint32_t len, uint32_t hash);
uint32_t backup_hash(void);

int32_t settings_last_page(void);
void settings_set_last_page(int32_t page);
