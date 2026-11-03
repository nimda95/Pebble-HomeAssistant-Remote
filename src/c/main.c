// HA Remote: a touchscreen TV / streaming-box remote that talks to Home Assistant through
// PebbleKit JS. The phone sends a packed layout; the watch draws it, recognizes gestures and
// reports them back. Up/Down switch pages, Select runs the page's `ok` action.
#include <pebble.h>
#include "app.h"
#include "comm.h"
#include "i18n.h"
#include "layout.h"
#include "protocol.h"
#include "render.h"

#define SLOP 8              // px of movement before a touch counts as moving
#define CANCEL_DIST 24      // px of movement that cancels a button press (as in the card)
#define SWIPE_THRESHOLD 16  // px, touchpad swipe recognition (as in the card)
#define DRAG_STEP 18        // px of movement per drag step on a dragpad
#define ROTATE_STEP DEG_TO_TRIGANGLE(20)
#define ROTATE_START DEG_TO_TRIGANGLE(8)
#define FLASH_MS 180
#define BUTTON_BASE ELEM_SELECT

App g;

typedef struct {
  bool down;
  int el;  // element index on the current page, -1 = none
  uint8_t part;
  int16_t x0, y0, x, y;
  bool cancelled;
  bool hold_fired;
  bool swiped;
  int16_t ax, ay;  // dragpad anchor
  int32_t last_angle, rot_acc;
  bool rotating;
} Touch;

static Touch s_t = {.el = -1};
static AppTimer *s_hold_timer;
static AppTimer *s_repeat_timer;
static int s_repeat_el = -1;
static uint8_t s_repeat_part;
static AppTimer *s_flash_timer;
static AppTimer *s_toast_timer;

static struct {
  AppTimer *timer;
  int el;
  uint8_t part;
} s_tap = {NULL, -1, 0};

#if defined(PBL_MICROPHONE)
static DictationSession *s_dictation;
static struct {
  int page;
  uint8_t elem, part;
} s_dict_target;
#endif

static void click_config(void *ctx);

// --------------------------------------------------------------------------- helpers

Page *app_page(void) {
  if (!g.layout || g.page < 0 || g.page >= g.layout->num_pages) return NULL;
  return &g.layout->pages[g.page];
}

static Elem *elem_at(int index) {
  Page *pg = app_page();
  if (!pg || index < 0 || index >= pg->count) return NULL;
  return &pg->elems[index];
}

static void redraw(void) {
  if (g.layer) layer_mark_dirty(g.layer);
}

static uint8_t part_flags(int el, uint8_t part) {
  Page *pg = app_page();
  if (!pg) return 0;
  if (el >= BUTTON_BASE) return pg->buttons[el - BUTTON_BASE];
  Elem *e = elem_at(el);
  return (e && part < NUM_PARTS) ? e->pf[part] : 0;
}

// Timings: the element's own, else the page's (hardware buttons use the page's).
static uint16_t hold_ms(int el) {
  Elem *e = elem_at(el);
  Page *pg = app_page();
  if (e && e->hold_ms) return e->hold_ms;
  return (pg && pg->hold_ms) ? pg->hold_ms : 500;
}

static uint16_t repeat_ms(int el) {
  Elem *e = elem_at(el);
  Page *pg = app_page();
  uint16_t ms = (e && e->repeat_ms) ? e->repeat_ms : (pg && pg->repeat_ms) ? pg->repeat_ms : 100;
  return ms < 60 ? 60 : ms;
}

static uint16_t double_ms(int el) {
  Elem *e = elem_at(el);
  Page *pg = app_page();
  if (e && e->double_ms) return e->double_ms;
  return (pg && pg->double_ms) ? pg->double_ms : 200;
}

static void haptic(uint32_t ms) {
  Page *pg = app_page();
  if (!pg || !(pg->flags & PG_HAPTICS)) return;
  static uint32_t seg[1];
  seg[0] = ms;
  vibes_enqueue_custom_pattern((VibePattern){.durations = seg, .num_segments = 1});
}

static void flash_cb(void *ctx) {
  s_flash_timer = NULL;
  g.flash_el = -1;
  redraw();
}

static void flash(int el, uint8_t part) {
  g.flash_el = el;
  g.flash_part = part;
  if (s_flash_timer) app_timer_reschedule(s_flash_timer, FLASH_MS);
  else s_flash_timer = app_timer_register(FLASH_MS, flash_cb, NULL);
  redraw();
}

static void fire(int el, uint8_t part, uint8_t gesture, int32_t value) {
  uint8_t id;
  if (el >= BUTTON_BASE) {
    id = (uint8_t)el;
  } else {
    Elem *e = elem_at(el);
    if (!e) return;
    id = e->id;
  }
  if (gesture == G_REPEAT && comm_pending() > 2) return;  // link is slow; skip this tick
  comm_send_event(g.page, id, part, gesture, value, NULL);
  if (gesture == G_DRAG || gesture == G_ROTATE) haptic(15);
  else if (gesture != G_REPEAT) haptic(30);
}

// --------------------------------------------------------------------------- pages

static void cancel_pending_tap(void) {
  if (s_tap.timer) app_timer_cancel(s_tap.timer);
  s_tap.timer = NULL;
  s_tap.el = -1;
}

static void stop_repeat(void) {
  if (s_repeat_timer) app_timer_cancel(s_repeat_timer);
  s_repeat_timer = NULL;
  s_repeat_el = -1;
}

static void cancel_hold(void) {
  if (s_hold_timer) app_timer_cancel(s_hold_timer);
  s_hold_timer = NULL;
}

static void reset_touch(void) {
  cancel_hold();
  stop_repeat();
  s_t.down = false;
  s_t.el = -1;
  g.touching = false;
  g.sliding = false;
  g.pressed_el = -1;
}

static void goto_page(int page, bool notify) {
  if (!g.layout) return;
  int n = g.layout->num_pages;
  page = ((page % n) + n) % n;
  cancel_pending_tap();
  reset_touch();
  g.page = page;
  settings_set_last_page(page);
  window_set_click_config_provider(g.window, click_config);
  if (!(g.layout->pages[page].flags & PG_TITLE) && n > 1) {
    app_show_toast(g.layout->pages[page].name, TOAST_INFO, 900);
  }
  if (notify) comm_send_page_shown(page);
  redraw();
}

// Runs the tap of a part: local page switch, or an event for the phone.
static void tap_now(int el, uint8_t part) {
  uint8_t pf = part_flags(el, part);
  if (pf & PF_LOCAL_NEXT) {
    haptic(20);
    goto_page(g.page + 1, true);
  } else if (pf & PF_LOCAL_PREV) {
    haptic(20);
    goto_page(g.page - 1, true);
  } else if (pf & PF_TAP) {
    fire(el, part, G_TAP, 0);
  }
}

static void pending_tap_cb(void *ctx) {
  s_tap.timer = NULL;
  int el = s_tap.el;
  s_tap.el = -1;
  tap_now(el, s_tap.part);
}

// Touch tap with double-tap detection when the part has a double-tap action.
static void touch_tap(int el, uint8_t part) {
  uint8_t pf = part_flags(el, part);
  if (!(pf & PF_DOUBLE)) {
    if (s_tap.timer) {  // another element is waiting for a double tap: let it go first
      app_timer_cancel(s_tap.timer);
      pending_tap_cb(NULL);
    }
    tap_now(el, part);
    return;
  }
  if (s_tap.timer && s_tap.el == el && s_tap.part == part) {
    cancel_pending_tap();
    fire(el, part, G_DOUBLE, 0);
    return;
  }
  if (s_tap.timer) {
    app_timer_cancel(s_tap.timer);
    pending_tap_cb(NULL);
  }
  s_tap.el = el;
  s_tap.part = part;
  s_tap.timer = app_timer_register(double_ms(el), pending_tap_cb, NULL);
}

// --------------------------------------------------------------------------- hold / repeat

static void repeat_cb(void *ctx) {
  s_repeat_timer = NULL;
  if (s_repeat_el < 0) return;
  fire(s_repeat_el, s_repeat_part, G_REPEAT, 0);
  s_repeat_timer = app_timer_register(repeat_ms(s_repeat_el), repeat_cb, NULL);
}

static void start_repeat(int el, uint8_t part) {
  stop_repeat();
  s_repeat_el = el;
  s_repeat_part = part;
  s_repeat_timer = app_timer_register(repeat_ms(el), repeat_cb, NULL);
}

// Hold reached: repeat the tap (hold_action: repeat) or send a hold event.
static void hold_reached(int el, uint8_t part) {
  uint8_t pf = part_flags(el, part);
  if (pf & PF_REPEAT) {
    haptic(20);
    start_repeat(el, part);
  } else if (pf & PF_HOLD) {
    fire(el, part, G_HOLD, 0);
  }
}

static void hold_cb(void *ctx) {
  s_hold_timer = NULL;
  if (!s_t.down || s_t.el < 0 || s_t.cancelled) return;
  s_t.hold_fired = true;
  hold_reached(s_t.el, s_t.part);
  redraw();
}

static void arm_hold(int el, uint8_t part) {
  cancel_hold();
  if (part_flags(el, part) & (PF_HOLD | PF_REPEAT)) {
    s_hold_timer = app_timer_register(hold_ms(el), hold_cb, NULL);
  }
}

// --------------------------------------------------------------------------- touch

static int32_t angle_of(const Elem *el, int x, int y) {
  GPoint c;
  int R, inner;
  circlepad_geometry(el, &c, &R, &inner);
  return atan2_lookup(y - c.y, x - c.x);
}

static int hit_test(int x, int y, uint8_t *part) {
  Page *pg = app_page();
  *part = PART_CENTER;
  if (!pg) return -1;
  GPoint p = GPoint(x, y);
  for (int i = 0; i < pg->count; i++) {
    Elem *el = &pg->elems[i];
    if (!grect_contains_point(&el->rect, &p)) continue;
    if (el->type == EL_CIRCLEPAD) {
      GPoint c;
      int R, inner;
      circlepad_geometry(el, &c, &R, &inner);
      int dx = x - c.x, dy = y - c.y;
      int d2 = dx * dx + dy * dy;
      if (d2 > (R + 4) * (R + 4)) continue;
      if (d2 <= inner * inner) *part = PART_CENTER;
      else if (abs(dx) > abs(dy)) *part = dx > 0 ? PART_RIGHT : PART_LEFT;
      else *part = dy > 0 ? PART_DOWN : PART_UP;
    }
    return i;
  }
  return -1;
}

static void slider_from_point(const Elem *el, int x, int y) {
  GRect r = el->rect;
  int v;
  if (el->flags & ELF_VERTICAL) v = ((r.origin.y + r.size.h - y) * 255) / (r.size.h ? r.size.h : 1);
  else v = ((x - r.origin.x) * 255) / (r.size.w ? r.size.w : 1);
  if (v < 0) v = 0;
  if (v > 255) v = 255;
  g.slide_value = v;
}

static void cancel_press(void) {
  s_t.cancelled = true;
  cancel_hold();
  stop_repeat();
  g.pressed_el = -1;
  redraw();
}

static void touch_down(int x, int y) {
  cancel_hold();
  stop_repeat();
  s_t = (Touch){.down = true, .el = -1, .x0 = x, .y0 = y, .x = x, .y = y, .ax = x, .ay = y};
  g.touch_x = x;
  g.touch_y = y;
  uint8_t part;
  int idx = hit_test(x, y, &part);
  s_t.el = idx;
  s_t.part = part;
  g.touching = true;
  g.pressed_el = idx;
  g.pressed_part = part;
  Elem *el = elem_at(idx);
  if (!el) {
    redraw();
    return;
  }
  if (el->type == EL_SLIDER) {
    g.sliding = true;
    slider_from_point(el, x, y);
  } else {
    if (el->type == EL_CIRCLEPAD) s_t.last_angle = angle_of(el, x, y);
    arm_hold(idx, part);
  }
  redraw();
}

static void touchpad_move(int idx, Elem *el, int x, int y) {
  if (el->flags & ELF_DRAG) {
    int sx = x - s_t.ax, sy = y - s_t.ay;
    if (abs(sx) >= DRAG_STEP || abs(sy) >= DRAG_STEP) {
      cancel_hold();
      s_t.swiped = true;
      uint8_t dir = abs(sx) > abs(sy) ? (sx > 0 ? PART_RIGHT : PART_LEFT) : (sy > 0 ? PART_DOWN : PART_UP);
      fire(idx, dir, G_DRAG, 0);
      flash(idx, dir);
      if (dir == PART_LEFT || dir == PART_RIGHT) s_t.ax += sx > 0 ? DRAG_STEP : -DRAG_STEP;
      else s_t.ay += sy > 0 ? DRAG_STEP : -DRAG_STEP;
    }
    return;
  }
  if (s_t.swiped) return;
  int dx = x - s_t.x0, dy = y - s_t.y0;
  int adx = abs(dx), ady = abs(dy);
  if (abs(adx - ady) <= SWIPE_THRESHOLD) return;
  cancel_hold();
  uint8_t dir = adx > ady ? (dx > 0 ? PART_RIGHT : PART_LEFT) : (dy > 0 ? PART_DOWN : PART_UP);
  s_t.swiped = true;
  s_t.part = dir;
  s_t.hold_fired = false;
  flash(idx, dir);
  tap_now(idx, dir);
  // Keep holding after a swipe to repeat it (hold_action: repeat) or send its hold action.
  if (g.layout && s_t.el == idx) arm_hold(idx, dir);
}

static void touch_move(int x, int y) {
  if (!s_t.down) return;
  s_t.x = x;
  s_t.y = y;
  g.touch_x = x;
  g.touch_y = y;
  Elem *el = elem_at(s_t.el);
  if (!el || s_t.cancelled) return;
  int adx = abs(x - s_t.x0), ady = abs(y - s_t.y0);
  switch (el->type) {
    case EL_BUTTON:
      if (adx > CANCEL_DIST || ady > CANCEL_DIST) cancel_press();
      break;
    case EL_SLIDER:
      slider_from_point(el, x, y);
      break;
    case EL_TOUCHPAD:
      touchpad_move(s_t.el, el, x, y);
      break;
    case EL_CIRCLEPAD:
      if ((el->flags & ELF_DRAG) && s_t.part != PART_CENTER) {
        int32_t a = angle_of(el, x, y);
        int32_t d = a - s_t.last_angle;
        if (d > TRIG_MAX_ANGLE / 2) d -= TRIG_MAX_ANGLE;
        if (d < -TRIG_MAX_ANGLE / 2) d += TRIG_MAX_ANGLE;
        s_t.last_angle = a;
        s_t.rot_acc += d;
        if (!s_t.rotating && abs(s_t.rot_acc) >= ROTATE_START) {
          s_t.rotating = true;
          cancel_hold();
          g.pressed_el = -1;
        }
        // atan2 grows toward +y (down the screen), which is clockwise.
        while (s_t.rotating && s_t.rot_acc >= ROTATE_STEP) {
          fire(s_t.el, PART_CENTER, G_ROTATE, 1);
          s_t.rot_acc -= ROTATE_STEP;
        }
        while (s_t.rotating && s_t.rot_acc <= -ROTATE_STEP) {
          fire(s_t.el, PART_CENTER, G_ROTATE, 0);
          s_t.rot_acc += ROTATE_STEP;
        }
      } else if (adx > CANCEL_DIST || ady > CANCEL_DIST) {
        cancel_press();
      }
      break;
  }
  redraw();
}

static void touch_up(void) {
  if (!s_t.down) return;
  s_t.down = false;
  cancel_hold();
  stop_repeat();
  int idx = s_t.el;
  Elem *el = elem_at(idx);
  if (el && !s_t.cancelled) {
    bool moved = abs(s_t.x - s_t.x0) > CANCEL_DIST || abs(s_t.y - s_t.y0) > CANCEL_DIST;
    switch (el->type) {
      case EL_SLIDER:
        el->value = g.slide_value;
        el->flags |= ELF_VALUE;
        fire(idx, PART_CENTER, G_SLIDE, g.slide_value);
        break;
      case EL_TOUCHPAD:
        if (!s_t.swiped && !s_t.hold_fired && !moved) touch_tap(idx, PART_CENTER);
        break;
      case EL_CIRCLEPAD:
        if (!s_t.rotating && !s_t.hold_fired) touch_tap(idx, s_t.part);
        break;
      default:
        if (!s_t.hold_fired) touch_tap(idx, s_t.part);
        break;
    }
    if (el->type == EL_BUTTON || (el->type == EL_CIRCLEPAD && !s_t.rotating)) {
      if (!s_t.hold_fired) flash(idx, s_t.part);
    }
  }
  g.touching = false;
  g.sliding = false;
  g.pressed_el = -1;
  redraw();
}

#if defined(PBL_TOUCH)
static void touch_handler(const TouchEvent *e, void *ctx) {
  switch (e->type) {
    case TouchEvent_Touchdown:
      // A touch that only woke the watch (no active interaction session) must not press anything.
      if (e->non_navigational) return;
      touch_down(e->x, e->y);
      break;
    case TouchEvent_PositionUpdate:
      touch_move(e->x, e->y);
      break;
    case TouchEvent_Liftoff:
      if (s_t.down && (e->x || e->y)) touch_move(e->x, e->y);
      touch_up();
      break;
  }
}
#endif

// --------------------------------------------------------------------------- buttons

static int button_el(ClickRecognizerRef r) {
  switch (click_recognizer_get_button_id(r)) {
    case BUTTON_ID_UP: return ELEM_UP;
    case BUTTON_ID_DOWN: return ELEM_DOWN;
    default: return ELEM_SELECT;
  }
}

static void button_single(ClickRecognizerRef r, void *ctx) {
  if (!g.layout) return;
  tap_now(button_el(r), PART_CENTER);
}

static void button_double(ClickRecognizerRef r, void *ctx) {
  fire(button_el(r), PART_CENTER, G_DOUBLE, 0);
}

static void button_long_down(ClickRecognizerRef r, void *ctx) {
  hold_reached(button_el(r), PART_CENTER);
}

static void button_long_up(ClickRecognizerRef r, void *ctx) {
  stop_repeat();
}

static void click_config(void *ctx) {
  Page *pg = app_page();
  static const ButtonId ids[3] = {BUTTON_ID_SELECT, BUTTON_ID_UP, BUTTON_ID_DOWN};
  for (int b = 0; b < 3; b++) {
    uint8_t pf = pg ? pg->buttons[b] : 0;
    window_single_click_subscribe(ids[b], button_single);
    if (pf & PF_DOUBLE) {
      window_multi_click_subscribe(ids[b], 2, 2, double_ms(-1) + 100, true, button_double);
    }
    if (pf & (PF_HOLD | PF_REPEAT)) {
      window_long_click_subscribe(ids[b], hold_ms(-1), button_long_down, button_long_up);
    }
  }
}

// --------------------------------------------------------------------------- phone callbacks

static void toast_cb(void *ctx) {
  s_toast_timer = NULL;
  g.toast_visible = false;
  redraw();
}

// Drops a UTF-8 character that a cut left incomplete at the end of `s`.
static void utf8_trim_end(char *s) {
  size_t n = strlen(s), i = n;
  while (i > 0 && ((uint8_t)s[i - 1] & 0xC0) == 0x80) i--;
  if (i == 0) return;
  uint8_t lead = (uint8_t)s[i - 1];
  size_t len = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : lead >= 0xC0 ? 2 : 1;
  if (n - (i - 1) < len) s[i - 1] = 0;
}

void app_show_toast(const char *text, uint8_t kind, uint32_t ms) {
  strncpy(g.toast, text, sizeof(g.toast) - 1);
  g.toast[sizeof(g.toast) - 1] = 0;
  if (strlen(text) >= sizeof(g.toast)) utf8_trim_end(g.toast);
  g.toast_kind = kind;
  g.toast_visible = true;
  if (s_toast_timer) app_timer_reschedule(s_toast_timer, ms);
  else s_toast_timer = app_timer_register(ms, toast_cb, NULL);
  redraw();
}

void app_on_toast(const char *text, uint8_t kind) {
  if (!text || !text[0]) return;
  if (kind == TOAST_ERROR) {
    static const uint32_t seg[] = {60, 80, 60};
    vibes_enqueue_custom_pattern((VibePattern){.durations = seg, .num_segments = 3});
  }
  uint32_t ms = kind == TOAST_ERROR ? 4000 : 2500;
  if (strlen(text) > 60) ms += 1500;
  app_show_toast(text, kind, ms);
}

void app_on_layout(Layout *layout) {
  bool first = g.layout == NULL;
  int keep = g.page;
  layout_destroy(g.layout);
  g.layout = layout;
  reset_touch();
  cancel_pending_tap();
  if (first) keep = layout->start_page != 255 ? layout->start_page : settings_last_page();
  if (keep < 0 || keep >= layout->num_pages) keep = 0;
  g.page = keep;
  window_set_click_config_provider(g.window, click_config);
  redraw();
  layout_save(layout);
  comm_send_page_shown(g.page);
}

void app_on_value(int page, uint8_t elem_id, uint8_t value) {
  if (!g.layout || page < 0 || page >= g.layout->num_pages) return;
  Page *pg = &g.layout->pages[page];
  for (int i = 0; i < pg->count; i++) {
    if (pg->elems[i].id == elem_id) {
      if (!(g.sliding && page == g.page && g.pressed_el == i)) {
        pg->elems[i].value = value;
        pg->elems[i].flags |= ELF_VALUE;
      }
    }
  }
  if (page == g.page) redraw();
}

void app_on_goto(int page) {
  goto_page(page, true);
}

void app_on_lang(void) {
  redraw();
}

#if defined(PBL_MICROPHONE)
static void dictation_cb(DictationSession *session, DictationSessionStatus status, char *text, void *ctx) {
  if (status == DictationSessionStatusSuccess && text && text[0]) {
    comm_send_event(s_dict_target.page, s_dict_target.elem, s_dict_target.part, G_TEXT, 0, text);
  } else if (status != DictationSessionStatusFailureTranscriptionRejected) {
    app_show_toast(_(STR_NO_DICTATION), TOAST_ERROR, 2500);
  }
}
#endif

void app_on_dictate(int page, uint8_t elem_id, uint8_t part, const char *prompt) {
#if defined(PBL_MICROPHONE)
  if (!s_dictation) s_dictation = dictation_session_create(256, dictation_cb, NULL);
  if (!s_dictation) {
    app_show_toast(_(STR_NO_DICTATION), TOAST_ERROR, 2500);
    return;
  }
  s_dict_target.page = page;
  s_dict_target.elem = elem_id;
  s_dict_target.part = part;
  dictation_session_enable_confirmation(s_dictation, true);
  dictation_session_start(s_dictation);
#else
  app_show_toast(_(STR_NO_MIC), TOAST_ERROR, 2500);
#endif
}

// --------------------------------------------------------------------------- window

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  g.layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(g.layer, render_update_proc);
  layer_add_child(root, g.layer);
}

static void window_unload(Window *window) {
  layer_destroy(g.layer);
  g.layer = NULL;
}

static void window_appear(Window *window) {
#if defined(PBL_TOUCH)
  window_set_touch_bridge_disabled(window, true);
  touch_service_subscribe(touch_handler, NULL);
  if (!touch_service_is_enabled()) {
    app_show_toast(_(STR_TOUCH_OFF), TOAST_INFO, 3500);
  }
#endif
}

static void window_disappear(Window *window) {
#if defined(PBL_TOUCH)
  touch_service_unsubscribe();
#endif
  reset_touch();
}

static void init(void) {
  g.pressed_el = -1;
  g.flash_el = -1;
  i18n_init();
  g.layout = layout_load();
  if (g.layout) {
    int p = g.layout->start_page != 255 ? g.layout->start_page : settings_last_page();
    g.page = (p >= 0 && p < g.layout->num_pages) ? p : 0;
  }
  g.window = window_create();
  window_set_background_color(g.window, GColorBlack);
  window_set_window_handlers(g.window, (WindowHandlers){
                                           .load = window_load,
                                           .unload = window_unload,
                                           .appear = window_appear,
                                           .disappear = window_disappear,
                                       });
  window_set_click_config_provider(g.window, click_config);
  comm_init();
  window_stack_push(g.window, true);
  comm_send_hello();
}

static void deinit(void) {
  comm_deinit();
#if defined(PBL_MICROPHONE)
  if (s_dictation) dictation_session_destroy(s_dictation);
#endif
  window_destroy(g.window);
  layout_destroy(g.layout);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
