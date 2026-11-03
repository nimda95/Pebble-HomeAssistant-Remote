#pragma once
#include <pebble.h>
#include "layout.h"

void render_update_proc(Layer *layer, GContext *ctx);

// Circlepad geometry shared with hit testing.
void circlepad_geometry(const Elem *el, GPoint *center, int *radius, int *inner);
