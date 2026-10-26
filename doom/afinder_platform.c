// aFinder platform layer for doomgeneric, built as a WASI reactor. The host (aFinder's Games panel)
// calls dg_start once, then dg_tick every frame, feeds keys through dg_key and reads the 32-bit
// XRGB frame from dg_screen. Time comes from WASI clock_gettime, files from the host's WASI shim.
//
// Copyright (C) 2026 aFinder contributors. GPLv2 or later, like doomgeneric (see COPYING).

#include <stdint.h>
#include <time.h>
#include "doomgeneric.h"

#define QUEUE 64

static uint16_t queue[QUEUE];
static unsigned head = 0, tail = 0;

void DG_Init(void) {}
void DG_DrawFrame(void) {}
// The host owns the frame loop; Doom never blocks.
void DG_SleepMs(uint32_t ms) { (void)ms; }
void DG_SetWindowTitle(const char *title) { (void)title; }
// WASI has no processes; i_system.c only uses it to show errors through zenity.
int system(const char *command) { (void)command; return -1; }

uint32_t DG_GetTicksMs(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
}

int DG_GetKey(int *pressed, unsigned char *key) {
  if (head == tail) return 0;
  uint16_t k = queue[tail];
  tail = (tail + 1) % QUEUE;
  *pressed = k >> 8;
  *key = k & 0xff;
  return 1;
}

__attribute__((export_name("dg_key"))) void dg_key(int pressed, int key) {
  unsigned next = (head + 1) % QUEUE;
  if (next == tail) return; // full: drop rather than overwrite unread keys
  queue[head] = (uint16_t)(((pressed ? 1 : 0) << 8) | (key & 0xff));
  head = next;
}

static char *args[] = {"doom", "-iwad", "freedoom1.wad", 0};

__attribute__((export_name("dg_start"))) void dg_start(void) { doomgeneric_Create(3, args); }
__attribute__((export_name("dg_tick"))) void dg_tick(void) { doomgeneric_Tick(); }
__attribute__((export_name("dg_screen"))) uint32_t *dg_screen(void) { return DG_ScreenBuffer; }
__attribute__((export_name("dg_width"))) int dg_width(void) { return DOOMGENERIC_RESX; }
__attribute__((export_name("dg_height"))) int dg_height(void) { return DOOMGENERIC_RESY; }
