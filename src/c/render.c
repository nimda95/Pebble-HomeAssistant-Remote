#include "render.h"
#include "app.h"
#include "i18n.h"
#include "protocol.h"

// Keep the drawing rules in sync with config/preview.js, which mirrors them for the
// settings page preview.

static GFont s_f14, s_f18, s_f24;

static void fonts_init(void) {
  if (s_f14) return;
  s_f14 = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  s_f18 = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  s_f24 = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
}

static GColor c8(uint8_t argb, GColor fallback) {
  return argb ? (GColor){.argb = argb} : fallback;
}

// Gothic glyphs sit below the top of their line box; this pulls text up to look centered.
static int font_top_pad(GFont f) {
  if (f == s_f24) return 6;
  if (f == s_f18) return 5;
  return 3;
}

static int font_px(GFont f) {
  if (f == s_f24) return 24;
  if (f == s_f18) return 18;
  return 14;
}

static int text_width(const char *text, GFont font) {
  GSize sz = graphics_text_layout_get_content_size(text, font, GRect(0, 0, 400, 60),
                                                   GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft);
  return sz.w;
}

static void draw_text_mid(GContext *ctx, const char *text, GFont font, GRect box, int cy, GColor color) {
  graphics_context_set_text_color(ctx, color);
  int px = font_px(font);
  GRect r = GRect(box.origin.x, cy - px / 2 - font_top_pad(font) - 1, box.size.w, px + 10);
  graphics_draw_text(ctx, text, font, r, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

// Largest bold Gothic that fits the box on one line.
static GFont fit_font(const char *text, GRect box) {
  GFont fonts[3] = {s_f24, s_f18, s_f14};
  for (int i = 0; i < 3; i++) {
    if (font_px(fonts[i]) + 4 <= box.size.h && text_width(text, fonts[i]) <= box.size.w - 4) return fonts[i];
  }
  return s_f14;
}

static void draw_icon(GContext *ctx, uint8_t index, GPoint center, GColor color) {
  GBitmap *bmp = layout_icon(g.layout, index, color);
  if (!bmp) return;
  GSize s = gbitmap_get_bounds(bmp).size;
  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(ctx, bmp, GRect(center.x - s.w / 2, center.y - s.h / 2, s.w, s.h));
  graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

static int icon_size(uint8_t index) {
  if (!g.layout || index == NO_ICON || index >= g.layout->num_icons || !g.layout->icons[index]) return 0;
  return gbitmap_get_bounds(g.layout->icons[index]).size.h;
}

static void draw_chevron(GContext *ctx, GPoint c, uint8_t dir, int s, GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 3);
  int h = s / 2;
  switch (dir) {
    case PART_UP:
      graphics_draw_line(ctx, GPoint(c.x - s, c.y + h), GPoint(c.x, c.y - h));
      graphics_draw_line(ctx, GPoint(c.x, c.y - h), GPoint(c.x + s, c.y + h));
      break;
    case PART_DOWN:
      graphics_draw_line(ctx, GPoint(c.x - s, c.y - h), GPoint(c.x, c.y + h));
      graphics_draw_line(ctx, GPoint(c.x, c.y + h), GPoint(c.x + s, c.y - h));
      break;
    case PART_LEFT:
      graphics_draw_line(ctx, GPoint(c.x + h, c.y - s), GPoint(c.x - h, c.y));
      graphics_draw_line(ctx, GPoint(c.x - h, c.y), GPoint(c.x + h, c.y + s));
      break;
    case PART_RIGHT:
      graphics_draw_line(ctx, GPoint(c.x - h, c.y - s), GPoint(c.x + h, c.y));
      graphics_draw_line(ctx, GPoint(c.x + h, c.y), GPoint(c.x - h, c.y + s));
      break;
  }
  graphics_context_set_stroke_width(ctx, 1);
}

static int min_i(int a, int b) { return a < b ? a : b; }

static void draw_button(GContext *ctx, const Elem *el, bool pressed) {
  Page *l = app_page();
  GRect r = el->rect;
  GColor bg = pressed ? l->accent : c8(el->bg, l->btn_bg);
  GColor fg = c8(el->fg, l->btn_fg);
  int radius = min_i(8, min_i(r.size.w, r.size.h) / 4);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, r, radius, GCornersAll);

  int cx = r.origin.x + r.size.w / 2;
  int cy = r.origin.y + r.size.h / 2;
  int is = icon_size(el->icon[0]);
  bool label = (el->flags & ELF_LABEL) && el->label[0];
  if (is && label) {
    int total = is + 16;
    int top = r.origin.y + (r.size.h - total) / 2;
    draw_icon(ctx, el->icon[0], GPoint(cx, top + is / 2), fg);
    draw_text_mid(ctx, el->label, s_f14, GRect(r.origin.x + 1, 0, r.size.w - 2, 0), top + is + 8, fg);
  } else if (is) {
    draw_icon(ctx, el->icon[0], GPoint(cx, cy), fg);
  } else if (label) {
    GFont f = fit_font(el->label, r);
    draw_text_mid(ctx, el->label, f, GRect(r.origin.x + 1, 0, r.size.w - 2, 0), cy, fg);
  }
}

static GPoint edge_point(GRect r, uint8_t dir, int inset) {
  int cx = r.origin.x + r.size.w / 2, cy = r.origin.y + r.size.h / 2;
  switch (dir) {
    case PART_UP: return GPoint(cx, r.origin.y + inset);
    case PART_DOWN: return GPoint(cx, r.origin.y + r.size.h - inset);
    case PART_LEFT: return GPoint(r.origin.x + inset, cy);
    default: return GPoint(r.origin.x + r.size.w - inset, cy);
  }
}

static void draw_touchpad(GContext *ctx, const Elem *el, int index) {
  Page *l = app_page();
  GRect r = el->rect;
  GColor bg = c8(el->bg, l->pad_bg);
  GColor fg = c8(el->fg, l->btn_fg);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, r, min_i(12, min_i(r.size.w, r.size.h) / 4), GCornersAll);

  int cx = r.origin.x + r.size.w / 2, cy = r.origin.y + r.size.h / 2;
  int chev = min_i(r.size.w, r.size.h) / 14;
  if (chev < 3) chev = 3;
  if (chev > 7) chev = 7;
  for (uint8_t d = PART_UP; d <= PART_RIGHT; d++) {
    bool flash = g.flash_el == index && g.flash_part == d;
    GColor c = flash ? l->accent : l->title_fg;
    if (el->icon[d] != NO_ICON) {
      int s = icon_size(el->icon[d]);
      draw_icon(ctx, el->icon[d], edge_point(r, d, s / 2 + 4), c);
    } else if (!(el->flags & ELF_DRAG) || flash) {
      draw_chevron(ctx, edge_point(r, d, chev + 5), d, chev, c);
    }
  }
  bool center_flash = g.flash_el == index && g.flash_part == PART_CENTER;
  if (el->icon[0] != NO_ICON) {
    draw_icon(ctx, el->icon[0], GPoint(cx, cy), center_flash ? l->accent : l->title_fg);
  } else {
    graphics_context_set_fill_color(ctx, center_flash ? l->accent : l->title_fg);
    graphics_fill_circle(ctx, GPoint(cx, cy), 3);
  }
  if ((el->flags & ELF_LABEL) && el->label[0]) {
    draw_text_mid(ctx, el->label, s_f14, GRect(r.origin.x, 0, r.size.w, 0), r.origin.y + r.size.h - 12, l->title_fg);
  }
  if (g.touching && g.pressed_el == index && grect_contains_point(&r, &GPoint(g.touch_x, g.touch_y))) {
    graphics_context_set_fill_color(ctx, l->accent);
    graphics_fill_circle(ctx, GPoint(g.touch_x, g.touch_y), 9);
  }
  (void)fg;
}

void circlepad_geometry(const Elem *el, GPoint *center, int *radius, int *inner) {
  GRect r = el->rect;
  int d = min_i(r.size.w, r.size.h);
  *center = GPoint(r.origin.x + r.size.w / 2, r.origin.y + r.size.h / 2);
  *radius = d / 2;
  *inner = d / 5;
}

static void draw_circlepad(GContext *ctx, const Elem *el, int index) {
  Page *l = app_page();
  GPoint c;
  int R, inner;
  circlepad_geometry(el, &c, &R, &inner);
  GColor bg = c8(el->bg, l->pad_bg);
  GColor fg = c8(el->fg, l->btn_fg);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_circle(ctx, c, R);

  bool pressed = g.pressed_el == index && g.touching;
  int hl = -1;
  if (pressed) hl = g.pressed_part;
  if (g.flash_el == index) hl = g.flash_part;
  if (hl >= PART_UP && hl <= PART_RIGHT) {
    static const int16_t mid[] = {0, 0, 180, 270, 90};
    int32_t a0 = DEG_TO_TRIGANGLE(mid[hl] - 45), a1 = DEG_TO_TRIGANGLE(mid[hl] + 45);
    graphics_context_set_fill_color(ctx, l->accent);
    GRect box = GRect(c.x - R, c.y - R, 2 * R, 2 * R);
    if (a0 < 0) {
      graphics_fill_radial(ctx, box, GOvalScaleModeFitCircle, R - inner, a0 + TRIG_MAX_ANGLE, TRIG_MAX_ANGLE);
      graphics_fill_radial(ctx, box, GOvalScaleModeFitCircle, R - inner, 0, a1);
    } else {
      graphics_fill_radial(ctx, box, GOvalScaleModeFitCircle, R - inner, a0, a1);
    }
  }
  graphics_context_set_fill_color(ctx, hl == PART_CENTER ? l->accent : c8(0, l->btn_bg));
  graphics_fill_circle(ctx, c, inner);

  int ring = (R + inner) / 2;
  int chev = R / 10;
  if (chev < 3) chev = 3;
  if (chev > 7) chev = 7;
  GPoint pos[5] = {c, GPoint(c.x, c.y - ring), GPoint(c.x, c.y + ring), GPoint(c.x - ring, c.y), GPoint(c.x + ring, c.y)};
  for (uint8_t d = PART_UP; d <= PART_RIGHT; d++) {
    if (el->icon[d] != NO_ICON) draw_icon(ctx, el->icon[d], pos[d], fg);
    else if (el->pf[d]) draw_chevron(ctx, pos[d], d, chev, fg);
  }
  if (el->icon[0] != NO_ICON) {
    draw_icon(ctx, el->icon[0], c, fg);
  } else if ((el->flags & ELF_LABEL) && el->label[0]) {
    GRect box = GRect(c.x - inner + 2, c.y - inner, 2 * inner - 4, 2 * inner);
    draw_text_mid(ctx, el->label, fit_font(el->label, box), box, c.y, fg);
  }
}

// Formats a 0..255 slider position as the value it stands for. Mirrors sliderText() in
// src/pkjs/lib/unpack.js and sliderValue() in src/pkjs/index.js.
static void slider_text(const Elem *el, uint8_t pos, char *buf, size_t len) {
  if (el->flags & ELF_PERCENT) {
    snprintf(buf, len, "%d%%", (pos * 100 + 127) / 255);
    return;
  }
  int64_t lo = el->min, hi = el->max, step = el->step;
  int64_t v = lo + ((hi - lo) * pos + 127) / 255;
  if (step > 0 && v >= lo) v = lo + ((2 * (v - lo) + step) / (2 * step)) * step;
  bool neg = v < 0;
  int64_t a = neg ? -v : v;
  int whole = (int)(a / 1000);
  int frac = (int)(a % 1000);
  const char *sign = neg ? "-" : "";
  switch (el->decimals) {
    case 0: snprintf(buf, len, "%s%d%s", sign, whole, el->unit); break;
    case 1: snprintf(buf, len, "%s%d.%01d%s", sign, whole, frac / 100, el->unit); break;
    case 2: snprintf(buf, len, "%s%d.%02d%s", sign, whole, frac / 10, el->unit); break;
    default: snprintf(buf, len, "%s%d.%03d%s", sign, whole, frac, el->unit); break;
  }
}

static void draw_slider(GContext *ctx, const Elem *el, int index) {
  Page *l = app_page();
  GRect r = el->rect;
  bool vertical = el->flags & ELF_VERTICAL;
  bool active = g.sliding && g.pressed_el == index;
  uint8_t value = active ? g.slide_value : el->value;
  GColor bg = c8(el->bg, l->btn_bg);
  GColor fg = c8(el->fg, l->btn_fg);
  int radius = min_i(8, min_i(r.size.w, r.size.h) / 3);
  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, r, radius, GCornersAll);

  GRect fill = r;
  if (vertical) {
    int h = (r.size.h * value) / 255;
    fill = GRect(r.origin.x, r.origin.y + r.size.h - h, r.size.w, h);
  } else {
    fill.size.w = (r.size.w * value) / 255;
  }
  if (fill.size.w > 0 && fill.size.h > 0) {
    graphics_context_set_fill_color(ctx, l->accent);
    graphics_fill_rect(ctx, fill, radius, GCornersAll);
  }

  int is = icon_size(el->icon[0]);
  GPoint ic = vertical ? GPoint(r.origin.x + r.size.w / 2, r.origin.y + r.size.h - is / 2 - 6)
                       : GPoint(r.origin.x + is / 2 + 6, r.origin.y + r.size.h / 2);
  if (is) draw_icon(ctx, el->icon[0], ic, fg);

  // While dragging, and once the value is known, show it ("22.5°", "40%"); otherwise the label.
  if (active || (el->flags & ELF_VALUE)) {
    char buf[24];
    slider_text(el, value, buf, sizeof(buf));
    GFont f = r.size.h >= 22 ? s_f18 : s_f14;
    if (vertical) {
      draw_text_mid(ctx, buf, f, r, r.origin.y + 14, fg);
    } else {
      GRect box = GRect(r.origin.x + is + 8, 0, r.size.w - is - 12, 0);
      if (is + 8 + text_width(buf, f) > r.size.w / 2 + 20) box = r;
      draw_text_mid(ctx, buf, f, box, r.origin.y + r.size.h / 2, fg);
    }
  } else if ((el->flags & ELF_LABEL) && el->label[0] && !vertical) {
    GRect box = GRect(r.origin.x + is + 8, 0, r.size.w - is - 12, 0);
    draw_text_mid(ctx, el->label, r.size.h >= 22 ? s_f18 : s_f14, box, r.origin.y + r.size.h / 2, fg);
  }
}

static void draw_title(GContext *ctx, GRect bounds, Page *pg) {
  Page *l = pg;
  int n = g.layout->num_pages;
  bool round = g.layout->flags & HDR_ROUND;
  bool title = pg->flags & PG_TITLE;
  char counter[16];
  bool use_counter = n > 10;
  if (use_counter) snprintf(counter, sizeof(counter), "%d/%d", g.page + 1, n);

  if (!round) {
    if (!title) return;
    int dots_w = n > 1 ? (use_counter ? 34 : n * 9) : 0;
    graphics_context_set_text_color(ctx, l->title_fg);
    graphics_draw_text(ctx, pg->name, s_f18, GRect(5, -3, bounds.size.w - 12 - dots_w, 22),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
    if (n > 1) {
      if (use_counter) {
        graphics_draw_text(ctx, counter, s_f14, GRect(bounds.size.w - 38, 0, 34, 18),
                           GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
      } else {
        for (int i = 0; i < n; i++) {
          GPoint p = GPoint(bounds.size.w - 8 - (n - 1 - i) * 9, 10);
          graphics_context_set_fill_color(ctx, i == g.page ? l->accent : l->title_fg);
          graphics_fill_circle(ctx, p, i == g.page ? 3 : 2);
        }
      }
    }
  } else {
    if (title) {
      graphics_context_set_text_color(ctx, l->title_fg);
      graphics_draw_text(ctx, pg->name, s_f18, GRect(50, 6, bounds.size.w - 100, 22),
                         GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    }
    if (n > 1) {
      int y = bounds.size.h - 11;
      if (use_counter) {
        graphics_context_set_text_color(ctx, l->title_fg);
        graphics_draw_text(ctx, counter, s_f14, GRect(0, y - 10, bounds.size.w, 18),
                           GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
      } else {
        int x0 = bounds.size.w / 2 - ((n - 1) * 9) / 2;
        for (int i = 0; i < n; i++) {
          graphics_context_set_fill_color(ctx, i == g.page ? l->accent : l->title_fg);
          graphics_fill_circle(ctx, GPoint(x0 + i * 9, y), i == g.page ? 3 : 2);
        }
      }
    }
  }
}

static void draw_toast(GContext *ctx, GRect bounds) {
  bool round = PBL_IF_ROUND_ELSE(true, false);
  int margin = round ? 34 : 6;
  int w = bounds.size.w - 2 * margin;
  GSize sz = graphics_text_layout_get_content_size(g.toast, s_f18, GRect(0, 0, w - 12, 80),
                                                   GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter);
  int h = sz.h + 14;
  if (h > 80) h = 80;
  int bottom = bounds.size.h - (round ? 30 : 6);
  GRect box = GRect(margin, bottom - h, w, h);
  GColor edge = g.toast_kind == TOAST_ERROR ? GColorRed : g.toast_kind == TOAST_OK ? GColorIslamicGreen
                                                                                    : (app_page() ? app_page()->accent : GColorVividCerulean);
  graphics_context_set_fill_color(ctx, edge);
  graphics_fill_rect(ctx, box, 8, GCornersAll);
  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(ctx, grect_inset(box, GEdgeInsets(2)), 6, GCornersAll);
  graphics_context_set_text_color(ctx, GColorWhite);
  graphics_draw_text(ctx, g.toast, s_f18, GRect(box.origin.x + 6, box.origin.y + 3, w - 12, h - 6),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

void render_update_proc(Layer *layer, GContext *ctx) {
  fonts_init();
  GRect bounds = layer_get_bounds(layer);
  Layout *l = g.layout;
  graphics_context_set_antialiased(ctx, true);

  if (!l) {
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, "HA Remote", s_f24, GRect(0, bounds.size.h / 2 - 50, bounds.size.w, 30),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
    graphics_context_set_text_color(ctx, GColorLightGray);
    graphics_draw_text(ctx, _(STR_CONNECTING), s_f18, GRect(16, bounds.size.h / 2 - 14, bounds.size.w - 32, 80),
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
    if (g.toast_visible) draw_toast(ctx, bounds);
    return;
  }

  Page *pg = app_page();
  graphics_context_set_fill_color(ctx, pg ? pg->bg : GColorBlack);
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  if (pg) {
    draw_title(ctx, bounds, pg);
    for (int i = 0; i < pg->count; i++) {
      const Elem *el = &pg->elems[i];
      bool pressed = g.touching && g.pressed_el == i;
      switch (el->type) {
        case EL_BUTTON: draw_button(ctx, el, pressed || (g.flash_el == i)); break;
        case EL_TOUCHPAD: draw_touchpad(ctx, el, i); break;
        case EL_CIRCLEPAD: draw_circlepad(ctx, el, i); break;
        case EL_SLIDER: draw_slider(ctx, el, i); break;
      }
    }
  }
  if (g.toast_visible) draw_toast(ctx, bounds);
}
