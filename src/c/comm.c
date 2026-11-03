#include "comm.h"
#include "app.h"
#include "i18n.h"
#include "layout.h"
#include "protocol.h"

#define QUEUE_LEN 12
#define TEXT_LEN 200
#define MAX_TRANSFER (200 * 1024)

typedef struct {
  uint8_t cmd;
  uint8_t page, elem, part, gesture;
  int32_t value;
  char text[TEXT_LEN];
} OutMsg;

static OutMsg s_queue[QUEUE_LEN];
static int s_head, s_count;
static bool s_busy;
static int s_retries;
static AppTimer *s_retry_timer;
static uint32_t s_inbox_size, s_outbox_size;

// Incoming transfers (layout and backup)
static uint8_t *s_rx_layout;
static uint32_t s_rx_layout_len;
static uint32_t s_rx_layout_hash;
static uint8_t *s_rx_backup;
static uint32_t s_rx_backup_len;
static uint32_t s_rx_backup_hash;

// Outgoing backup (restore to phone)
static bool s_tx_backup;
static uint32_t s_tx_backup_off, s_tx_backup_total;
static uint32_t s_tx_backup_chunk_off;  // offset of the chunk in flight
static bool s_sending_backup;           // the message in flight is a backup chunk

static void pump(void);

int comm_pending(void) {
  return s_count + (s_busy ? 1 : 0);
}

static OutMsg *enqueue(uint8_t cmd) {
  if (s_count >= QUEUE_LEN) {
    APP_LOG(APP_LOG_LEVEL_WARNING, "send queue full, dropping cmd %d", cmd);
    return NULL;
  }
  OutMsg *m = &s_queue[(s_head + s_count) % QUEUE_LEN];
  memset(m, 0, sizeof(*m));
  m->cmd = cmd;
  s_count++;
  return m;
}

static void retry_cb(void *ctx) {
  s_retry_timer = NULL;
  pump();
}

static bool send_backup_chunk(void) {
  DictionaryIterator *it;
  if (app_message_outbox_begin(&it) != APP_MSG_OK) return false;
  uint32_t chunk = s_outbox_size > 128 ? s_outbox_size - 96 : 64;
  uint32_t left = s_tx_backup_total - s_tx_backup_off;
  if (chunk > left) chunk = left;
  s_tx_backup_chunk_off = s_tx_backup_off;
  dict_write_uint8(it, MESSAGE_KEY_cmd, CMD_BACKUP_DATA);
  dict_write_int32(it, MESSAGE_KEY_total, (int32_t)s_tx_backup_total);
  dict_write_int32(it, MESSAGE_KEY_offset, (int32_t)s_tx_backup_off);
  if (chunk) {
    uint8_t *buf = malloc(chunk);
    if (!buf) return false;
    uint32_t n = backup_read(s_tx_backup_off, buf, chunk);
    dict_write_data(it, MESSAGE_KEY_data, buf, n);
    free(buf);
    s_tx_backup_off += n;
    if (n == 0) s_tx_backup_off = s_tx_backup_total;
  }
  if (app_message_outbox_send() != APP_MSG_OK) return false;
  if (s_tx_backup_off >= s_tx_backup_total) s_tx_backup = false;
  return true;
}

static void pump(void) {
  if (s_busy || s_retry_timer) return;
  if (s_tx_backup) {
    if (send_backup_chunk()) {
      s_busy = true;
      s_sending_backup = true;
    } else {
      s_retry_timer = app_timer_register(300, retry_cb, NULL);
    }
    return;
  }
  if (!s_count) return;
  OutMsg *m = &s_queue[s_head];
  DictionaryIterator *it;
  AppMessageResult r = app_message_outbox_begin(&it);
  if (r != APP_MSG_OK) {
    s_retry_timer = app_timer_register(200, retry_cb, NULL);
    return;
  }
  dict_write_uint8(it, MESSAGE_KEY_cmd, m->cmd);
  switch (m->cmd) {
    case CMD_HELLO: {
      GRect b = layer_get_bounds(window_get_root_layer(g.window));
      dict_write_int32(it, MESSAGE_KEY_hash, (int32_t)(g.layout ? g.layout->hash : 0));
      dict_write_int32(it, MESSAGE_KEY_screen_w, b.size.w);
      dict_write_int32(it, MESSAGE_KEY_screen_h, b.size.h);
      dict_write_uint8(it, MESSAGE_KEY_shape, PBL_IF_ROUND_ELSE(1, 0));
      dict_write_int32(it, MESSAGE_KEY_inbox_size, (int32_t)s_inbox_size);
      dict_write_int32(it, MESSAGE_KEY_persist_max, (int32_t)persist_get_max_size());
      // bit 0: has a backup; bits 1..: languages the font can draw
      dict_write_int32(it, MESSAGE_KEY_value, (backup_exists() ? 1 : 0) | (i18n_drawable() << 1));
      dict_write_cstring(it, MESSAGE_KEY_text, i18n_get_system_locale());
      dict_write_int32(it, MESSAGE_KEY_backup_hash, (int32_t)backup_hash());
      dict_write_uint8(it, MESSAGE_KEY_page, (uint8_t)g.page);
      break;
    }
    case CMD_EVENT:
      dict_write_uint8(it, MESSAGE_KEY_page, m->page);
      dict_write_uint8(it, MESSAGE_KEY_elem, m->elem);
      dict_write_uint8(it, MESSAGE_KEY_part, m->part);
      dict_write_uint8(it, MESSAGE_KEY_gesture, m->gesture);
      dict_write_int32(it, MESSAGE_KEY_value, m->value);
      if (m->text[0]) dict_write_cstring(it, MESSAGE_KEY_text, m->text);
      break;
    case CMD_PAGE_SHOWN:
      dict_write_uint8(it, MESSAGE_KEY_page, m->page);
      break;
  }
  if (app_message_outbox_send() == APP_MSG_OK) {
    s_busy = true;
  } else {
    s_retry_timer = app_timer_register(200, retry_cb, NULL);
  }
}

static void outbox_sent(DictionaryIterator *it, void *ctx) {
  s_busy = false;
  s_retries = 0;
  // A backup chunk isn't in the queue; everything else is the queue head.
  if (!s_sending_backup && s_count) {
    s_head = (s_head + 1) % QUEUE_LEN;
    s_count--;
  }
  s_sending_backup = false;
  pump();
}

static void outbox_failed(DictionaryIterator *it, AppMessageResult reason, void *ctx) {
  s_busy = false;
  bool backup = s_sending_backup;
  s_sending_backup = false;
  if (++s_retries > 3) {
    s_retries = 0;
    if (backup) {
      s_tx_backup = false;
    } else if (s_count) {
      APP_LOG(APP_LOG_LEVEL_WARNING, "dropping message cmd %d (%d)", s_queue[s_head].cmd, reason);
      s_head = (s_head + 1) % QUEUE_LEN;
      s_count--;
    }
  } else if (backup) {
    // resend the chunk that failed
    s_tx_backup_off = s_tx_backup_chunk_off;
    s_tx_backup = true;
  }
  if (!s_retry_timer) s_retry_timer = app_timer_register(400 * (s_retries + 1), retry_cb, NULL);
}

// Reads an integer tuple of any width/signedness.
static int32_t t_int(DictionaryIterator *it, uint32_t key, int32_t dflt) {
  Tuple *t = dict_find(it, key);
  if (!t) return dflt;
  if (t->type == TUPLE_INT) {
    switch (t->length) {
      case 1: return t->value->int8;
      case 2: return t->value->int16;
      default: return t->value->int32;
    }
  }
  if (t->type == TUPLE_UINT) {
    switch (t->length) {
      case 1: return t->value->uint8;
      case 2: return t->value->uint16;
      default: return (int32_t)t->value->uint32;
    }
  }
  return dflt;
}

static const char *t_str(DictionaryIterator *it, uint32_t key) {
  Tuple *t = dict_find(it, key);
  return (t && t->type == TUPLE_CSTRING) ? t->value->cstring : "";
}

static void rx_chunk(uint8_t *buf, uint32_t total, DictionaryIterator *it) {
  Tuple *d = dict_find(it, MESSAGE_KEY_data);
  uint32_t off = (uint32_t)t_int(it, MESSAGE_KEY_offset, 0);
  if (!buf || !d || d->type != TUPLE_BYTE_ARRAY) return;
  if (off > total || d->length > total - off) return;
  memcpy(buf + off, d->value->data, d->length);
}

static void inbox_received(DictionaryIterator *it, void *ctx) {
  int cmd = t_int(it, MESSAGE_KEY_cmd, -1);
  switch (cmd) {
    case CMD_PHONE_READY:
      comm_send_hello();
      break;

    case CMD_LAYOUT_BEGIN: {
      free(s_rx_layout);
      s_rx_layout = NULL;
      s_rx_layout_len = (uint32_t)t_int(it, MESSAGE_KEY_total, 0);
      s_rx_layout_hash = (uint32_t)t_int(it, MESSAGE_KEY_hash, 0);
      if (s_rx_layout_len && s_rx_layout_len <= MAX_TRANSFER) s_rx_layout = malloc(s_rx_layout_len);
      if (!s_rx_layout) APP_LOG(APP_LOG_LEVEL_ERROR, "no memory for layout (%d)", (int)s_rx_layout_len);
      break;
    }
    case CMD_LAYOUT_CHUNK:
      rx_chunk(s_rx_layout, s_rx_layout_len, it);
      break;
    case CMD_LAYOUT_END: {
      if (!s_rx_layout) break;
      Layout *l = layout_parse(s_rx_layout, s_rx_layout_len, s_rx_layout_hash);
      s_rx_layout = NULL;  // owned by the layout now (or freed on failure)
      if (l) app_on_layout(l);
      else app_show_toast(_(STR_BROKEN_LAYOUT), TOAST_ERROR, 4000);
      break;
    }

    case CMD_TOAST:
      app_on_toast(t_str(it, MESSAGE_KEY_text), (uint8_t)t_int(it, MESSAGE_KEY_value, TOAST_INFO));
      break;
    case CMD_VALUE:
      app_on_value(t_int(it, MESSAGE_KEY_page, 0), (uint8_t)t_int(it, MESSAGE_KEY_elem, 0),
                   (uint8_t)t_int(it, MESSAGE_KEY_value, 0));
      break;
    case CMD_GOTO:
      app_on_goto(t_int(it, MESSAGE_KEY_page, 0));
      break;
    case CMD_DICTATE:
      app_on_dictate(t_int(it, MESSAGE_KEY_page, 0), (uint8_t)t_int(it, MESSAGE_KEY_elem, 0),
                     (uint8_t)t_int(it, MESSAGE_KEY_part, 0), t_str(it, MESSAGE_KEY_text));
      break;

    case CMD_BACKUP_BEGIN:
      free(s_rx_backup);
      s_rx_backup = NULL;
      s_rx_backup_len = (uint32_t)t_int(it, MESSAGE_KEY_total, 0);
      s_rx_backup_hash = (uint32_t)t_int(it, MESSAGE_KEY_hash, 0);
      if (s_rx_backup_len && s_rx_backup_len <= MAX_TRANSFER) s_rx_backup = calloc(1, s_rx_backup_len);
      break;
    case CMD_BACKUP_CHUNK:
      rx_chunk(s_rx_backup, s_rx_backup_len, it);
      break;
    case CMD_BACKUP_END:
      if (s_rx_backup) {
        backup_save(s_rx_backup, s_rx_backup_len, s_rx_backup_hash);
        free(s_rx_backup);
        s_rx_backup = NULL;
      }
      break;
    case CMD_BACKUP_REQUEST:
      s_tx_backup = true;
      s_tx_backup_off = 0;
      s_tx_backup_total = backup_size();
      pump();
      break;
    case CMD_LANG:
      if (i18n_set(t_str(it, MESSAGE_KEY_text))) app_on_lang();
      break;
  }
}

static void inbox_dropped(AppMessageResult reason, void *ctx) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "inbox dropped: %d", reason);
}

static void app_connection(bool connected) {
  if (connected) comm_send_hello();
}

void comm_init(void) {
  s_inbox_size = app_message_inbox_size_maximum();
  s_outbox_size = app_message_outbox_size_maximum();
  if (s_inbox_size > 8200) s_inbox_size = 8200;
  if (s_outbox_size > 8200) s_outbox_size = 8200;
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_sent(outbox_sent);
  app_message_register_outbox_failed(outbox_failed);
  app_message_open(s_inbox_size, s_outbox_size);
  connection_service_subscribe((ConnectionHandlers){.pebble_app_connection_handler = app_connection});
}

void comm_deinit(void) {
  connection_service_unsubscribe();
  free(s_rx_layout);
  free(s_rx_backup);
  s_rx_layout = s_rx_backup = NULL;
}

void comm_send_hello(void) {
  // Only one HELLO in the queue at a time.
  for (int i = 0; i < s_count; i++) {
    if (s_queue[(s_head + i) % QUEUE_LEN].cmd == CMD_HELLO && (i > 0 || !s_busy)) return;
  }
  if (enqueue(CMD_HELLO)) pump();
}

void comm_send_event(int page, uint8_t elem_id, uint8_t part, uint8_t gesture, int32_t value, const char *text) {
  OutMsg *m = enqueue(CMD_EVENT);
  if (!m) return;
  m->page = page;
  m->elem = elem_id;
  m->part = part;
  m->gesture = gesture;
  m->value = value;
  if (text) strncpy(m->text, text, TEXT_LEN - 1);
  pump();
}

void comm_send_page_shown(int page) {
  OutMsg *m = enqueue(CMD_PAGE_SHOWN);
  if (!m) return;
  m->page = page;
  pump();
}
