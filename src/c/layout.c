#include "layout.h"

// Persistent storage keys
#define KEY_LAYOUT_LEN 1
#define KEY_LAYOUT_HASH 2
#define KEY_BACKUP_LEN 3
#define KEY_LAST_PAGE 4
#define KEY_BACKUP_HASH 5
#define KEY_LAYOUT_BASE 1000  // 256-byte chunks
#define KEY_BACKUP_BASE 3000

#define CHUNK PERSIST_DATA_MAX_LENGTH
#define MAX_LAYOUT (200 * 1024)
#define MAX_BACKUP (256 * 1024)

typedef struct {
  const uint8_t *p;
  const uint8_t *end;
  bool ok;
} Reader;

static uint8_t rd_u8(Reader *r) {
  if (r->p + 1 > r->end) {
    r->ok = false;
    return 0;
  }
  return *r->p++;
}

static uint16_t rd_u16(Reader *r) {
  uint16_t lo = rd_u8(r);
  uint16_t hi = rd_u8(r);
  return lo | (hi << 8);
}

static int32_t rd_i32(Reader *r) {
  uint32_t a = rd_u16(r);
  uint32_t b = rd_u16(r);
  return (int32_t)(a | (b << 16));
}

// Strings are stored as u8 length (including the NUL) followed by the bytes and a NUL.
static const char *rd_str(Reader *r) {
  uint8_t n = rd_u8(r);
  if (!r->ok || n == 0 || r->p + n > r->end || r->p[n - 1] != 0) {
    r->ok = false;
    return "";
  }
  const char *s = (const char *)r->p;
  r->p += n;
  return s;
}

static GColor color_or(uint8_t argb) {
  return (GColor){.argb = argb};
}

Layout *layout_parse(uint8_t *blob, uint32_t len, uint32_t hash) {
  Reader r = {.p = blob, .end = blob + len, .ok = true};
  Layout *l = calloc(1, sizeof(Layout));
  if (!l) {
    free(blob);
    return NULL;
  }
  l->blob = blob;
  l->len = len;
  l->hash = hash;

  if (rd_u8(&r) != 'H' || rd_u8(&r) != 'R' || rd_u8(&r) != 2) goto fail;
  l->flags = rd_u8(&r);
  l->num_pages = rd_u8(&r);
  l->num_icons = rd_u8(&r);
  l->start_page = rd_u8(&r);
  rd_u8(&r);
  if (!r.ok || l->num_pages == 0) goto fail;

  l->pages = calloc(l->num_pages, sizeof(Page));
  if (!l->pages) goto fail;
  for (int i = 0; i < l->num_pages; i++) {
    Page *pg = &l->pages[i];
    pg->count = rd_u8(&r);
    pg->name = rd_str(&r);
    pg->flags = rd_u8(&r);
    pg->bg = color_or(rd_u8(&r));
    pg->btn_bg = color_or(rd_u8(&r));
    pg->btn_fg = color_or(rd_u8(&r));
    pg->accent = color_or(rd_u8(&r));
    pg->title_fg = color_or(rd_u8(&r));
    pg->pad_bg = color_or(rd_u8(&r));
    pg->hold_ms = rd_u8(&r) * 10;
    pg->repeat_ms = rd_u8(&r) * 10;
    pg->double_ms = rd_u8(&r) * 10;
    for (int b = 0; b < 3; b++) pg->buttons[b] = rd_u8(&r);
    if (!r.ok) goto fail;
    if (pg->count) {
      pg->elems = calloc(pg->count, sizeof(Elem));
      if (!pg->elems) goto fail;
    }
    for (int e = 0; e < pg->count; e++) {
      Elem *el = &pg->elems[e];
      el->id = rd_u8(&r);
      el->type = rd_u8(&r);
      el->flags = rd_u8(&r);
      int16_t x = rd_u16(&r), y = rd_u16(&r), w = rd_u16(&r), h = rd_u16(&r);
      el->rect = GRect(x, y, w, h);
      el->fg = rd_u8(&r);
      el->bg = rd_u8(&r);
      el->value = rd_u8(&r);
      el->hold_ms = rd_u8(&r) * 10;
      el->repeat_ms = rd_u8(&r) * 10;
      el->double_ms = rd_u8(&r) * 10;
      for (int k = 0; k < NUM_PARTS; k++) el->pf[k] = rd_u8(&r);
      for (int k = 0; k < NUM_PARTS; k++) el->icon[k] = rd_u8(&r);
      el->label = rd_str(&r);
      el->unit = "";
      if (el->type == EL_SLIDER) {
        el->min = rd_i32(&r);
        el->max = rd_i32(&r);
        el->step = rd_i32(&r);
        el->decimals = rd_u8(&r);
        el->unit = rd_str(&r);
      }
      if (!r.ok) goto fail;
    }
  }

  if (l->num_icons) {
    l->icons = calloc(l->num_icons, sizeof(GBitmap *));
    l->palettes = calloc(l->num_icons * 4, sizeof(GColor));
    if (!l->icons || !l->palettes) goto fail;
  }
  for (int i = 0; i < l->num_icons; i++) {
    uint8_t size = rd_u8(&r);
    uint16_t stride = (size + 3) / 4;
    uint32_t bytes = (uint32_t)stride * size;
    if (!r.ok || size == 0 || r.p + bytes > r.end) goto fail;
    GColor *pal = &l->palettes[i * 4];
    pal[0] = GColorClear;
    pal[1] = pal[2] = pal[3] = GColorWhite;
    GBitmap *bmp = gbitmap_create_blank_with_palette(GSize(size, size), GBitmapFormat2BitPalette, pal, false);
    if (bmp) {
      uint8_t *data = gbitmap_get_data(bmp);
      uint16_t row = gbitmap_get_bytes_per_row(bmp);
      for (int y = 0; y < size; y++) {
        memcpy(data + y * row, r.p + y * stride, stride < row ? stride : row);
      }
    }
    l->icons[i] = bmp;
    r.p += bytes;
  }
  return l;

fail:
  APP_LOG(APP_LOG_LEVEL_ERROR, "layout parse failed at %d/%d", (int)(r.p - blob), (int)len);
  layout_destroy(l);
  return NULL;
}

void layout_destroy(Layout *l) {
  if (!l) return;
  if (l->pages) {
    for (int i = 0; i < l->num_pages; i++) free(l->pages[i].elems);
    free(l->pages);
  }
  if (l->icons) {
    for (int i = 0; i < l->num_icons; i++) {
      if (l->icons[i]) gbitmap_destroy(l->icons[i]);
    }
    free(l->icons);
  }
  free(l->palettes);
  free(l->blob);
  free(l);
}

GBitmap *layout_icon(Layout *l, uint8_t index, GColor color) {
  if (!l || index == NO_ICON || index >= l->num_icons || !l->icons[index]) return NULL;
  GColor *pal = &l->palettes[index * 4];
  uint8_t rgb = color.argb & 0x3f;
  pal[0] = GColorClear;
  pal[1] = (GColor){.argb = (1 << 6) | rgb};
  pal[2] = (GColor){.argb = (2 << 6) | rgb};
  pal[3] = (GColor){.argb = (3 << 6) | rgb};
  return l->icons[index];
}

// --- persistence -------------------------------------------------------------

static void write_chunks(uint32_t base, const uint8_t *data, uint32_t len) {
  for (uint32_t off = 0, k = 0; off < len; off += CHUNK, k++) {
    uint32_t n = len - off < CHUNK ? len - off : CHUNK;
    persist_write_data(base + k, data + off, n);
  }
}

static bool read_chunks(uint32_t base, uint8_t *dst, uint32_t len) {
  for (uint32_t off = 0, k = 0; off < len; off += CHUNK, k++) {
    uint32_t n = len - off < CHUNK ? len - off : CHUNK;
    if (persist_read_data(base + k, dst + off, n) != (int)n) return false;
  }
  return true;
}

static uint32_t storage_left(void) {
  // persist_get_max_size() reports 1 MB per app on the new watches.
  return persist_get_max_size();
}

Layout *layout_load(void) {
  if (!persist_exists(KEY_LAYOUT_LEN)) return NULL;
  uint32_t len = persist_read_int(KEY_LAYOUT_LEN);
  uint32_t hash = persist_read_int(KEY_LAYOUT_HASH);
  if (len == 0 || len > MAX_LAYOUT) return NULL;
  uint8_t *blob = malloc(len);
  if (!blob) return NULL;
  if (!read_chunks(KEY_LAYOUT_BASE, blob, len)) {
    free(blob);
    return NULL;
  }
  return layout_parse(blob, len, hash);
}

void layout_save(const Layout *l) {
  if (!l || l->len > MAX_LAYOUT || l->len + 4096 > storage_left()) {
    persist_delete(KEY_LAYOUT_LEN);
    return;
  }
  // Invalidate first so a crash mid-write never leaves a mixed layout behind.
  persist_delete(KEY_LAYOUT_LEN);
  write_chunks(KEY_LAYOUT_BASE, l->blob, l->len);
  persist_write_int(KEY_LAYOUT_HASH, (int32_t)l->hash);
  persist_write_int(KEY_LAYOUT_LEN, (int32_t)l->len);
}

uint32_t layout_saved_hash(void) {
  if (!persist_exists(KEY_LAYOUT_LEN)) return 0;
  return (uint32_t)persist_read_int(KEY_LAYOUT_HASH);
}

bool backup_exists(void) {
  return persist_exists(KEY_BACKUP_LEN) && persist_read_int(KEY_BACKUP_LEN) > 0;
}

uint32_t backup_size(void) {
  return backup_exists() ? (uint32_t)persist_read_int(KEY_BACKUP_LEN) : 0;
}

// Reads `len` bytes at `offset` from the backup (chunk aligned reads are cheapest).
uint32_t backup_read(uint32_t offset, uint8_t *dst, uint32_t len) {
  uint32_t total = backup_size();
  if (offset >= total) return 0;
  if (offset + len > total) len = total - offset;
  uint8_t tmp[CHUNK];
  uint32_t done = 0;
  while (done < len) {
    uint32_t pos = offset + done;
    uint32_t k = pos / CHUNK;
    uint32_t in = pos % CHUNK;
    uint32_t chunk_len = total - k * CHUNK < CHUNK ? total - k * CHUNK : CHUNK;
    if (persist_read_data(KEY_BACKUP_BASE + k, tmp, chunk_len) != (int)chunk_len) break;
    uint32_t n = chunk_len - in;
    if (n > len - done) n = len - done;
    memcpy(dst + done, tmp + in, n);
    done += n;
  }
  return done;
}

void backup_save(const uint8_t *data, uint32_t len, uint32_t hash) {
  persist_delete(KEY_BACKUP_LEN);
  persist_delete(KEY_BACKUP_HASH);
  if (!data || len == 0 || len > MAX_BACKUP || len + 8192 > storage_left()) return;
  write_chunks(KEY_BACKUP_BASE, data, len);
  persist_write_int(KEY_BACKUP_HASH, (int32_t)hash);
  persist_write_int(KEY_BACKUP_LEN, (int32_t)len);
}

uint32_t backup_hash(void) {
  return backup_exists() && persist_exists(KEY_BACKUP_HASH) ? (uint32_t)persist_read_int(KEY_BACKUP_HASH) : 0;
}

int32_t settings_last_page(void) {
  return persist_exists(KEY_LAST_PAGE) ? persist_read_int(KEY_LAST_PAGE) : 0;
}

void settings_set_last_page(int32_t page) {
  persist_write_int(KEY_LAST_PAGE, page);
}
