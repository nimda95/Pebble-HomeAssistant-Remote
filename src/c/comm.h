#pragma once
#include <pebble.h>

void comm_init(void);
void comm_deinit(void);
void comm_send_hello(void);
void comm_send_event(int page, uint8_t elem_id, uint8_t part, uint8_t gesture, int32_t value, const char *text);
void comm_send_page_shown(int page);
// Number of messages waiting to be sent (used to drop hold-repeat ticks when the link is slow).
int comm_pending(void);
