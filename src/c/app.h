#pragma once
#include <pebble.h>
#include "layout.h"

// Shared UI state (one window, drawn by a single update proc).
typedef struct {
  Window *window;
  Layer *layer;
  Layout *layout;
  int page;

  // touch feedback
  int pressed_el;  // index into the current page's elements, -1 = none
  uint8_t pressed_part;
  bool touching;
  int16_t touch_x, touch_y;
  bool sliding;
  uint8_t slide_value;
  int flash_el;
  uint8_t flash_part;

  // toast
  char toast[128];
  uint8_t toast_kind;
  bool toast_visible;
} App;

extern App g;

Page *app_page(void);

// Called by comm.c
void app_on_layout(Layout *layout);
void app_on_toast(const char *text, uint8_t kind);
void app_on_value(int page, uint8_t elem_id, uint8_t value);
void app_on_goto(int page);
void app_on_dictate(int page, uint8_t elem_id, uint8_t part, const char *prompt);
void app_on_lang(void);
void app_show_toast(const char *text, uint8_t kind, uint32_t ms);
