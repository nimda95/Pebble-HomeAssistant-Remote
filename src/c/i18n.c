#include "i18n.h"

#define KEY_LANG 6  // saved language setting: language index + 1 (missing = automatic)

// Keep the order in sync with LANGS in src/pkjs/lib/i18n.js.
enum { L_EN, L_FR, L_AR, L_TR, L_DE, L_NL, L_ES, L_ID, L_COUNT };
static const char LANG_CODES[L_COUNT][3] = {"en", "fr", "ar", "tr", "de", "nl", "es", "id"};

// Keep Arabic strings short: the firmware cuts RTL lines after about 30 letters.
static const char *const STRS[L_COUNT][STR_COUNT] = {
  [L_EN] = {
    [STR_CONNECTING] = "Connecting to the phone...",
    [STR_BROKEN_LAYOUT] = "Received a broken layout",
    [STR_NO_DICTATION] = "Dictation unavailable",
    [STR_NO_MIC] = "This watch has no microphone",
    [STR_TOUCH_OFF] = "Touch is off. Use Up/Down for pages, Select for OK.",
  },
  [L_FR] = {
    [STR_CONNECTING] = "Connexion au téléphone...",
    [STR_BROKEN_LAYOUT] = "Mise en page reçue invalide",
    [STR_NO_DICTATION] = "Dictée indisponible",
    [STR_NO_MIC] = "Cette montre n'a pas de micro",
    [STR_TOUCH_OFF] = "Tactile coupé. Haut/Bas : pages, Sélection : OK.",
  },
  [L_AR] = {
    [STR_CONNECTING] = "جار الاتصال بالهاتف...",
    [STR_BROKEN_LAYOUT] = "وصل تخطيط تالف",
    [STR_NO_DICTATION] = "الإملاء الصوتي غير متاح",
    [STR_NO_MIC] = "الساعة بلا ميكروفون",
    [STR_TOUCH_OFF] = "اللمس معطل. استخدم الأزرار",
  },
  [L_TR] = {
    [STR_CONNECTING] = "Telefona bağlanılıyor...",
    [STR_BROKEN_LAYOUT] = "Bozuk bir düzen alındı",
    [STR_NO_DICTATION] = "Dikte kullanılamıyor",
    [STR_NO_MIC] = "Bu saatte mikrofon yok",
    [STR_TOUCH_OFF] = "Dokunma kapalı. Yukarı/Aşağı: sayfa, Seç: Tamam.",
  },
  [L_DE] = {
    [STR_CONNECTING] = "Verbindung zum Telefon...",
    [STR_BROKEN_LAYOUT] = "Fehlerhaftes Layout empfangen",
    [STR_NO_DICTATION] = "Diktieren nicht verfügbar",
    [STR_NO_MIC] = "Diese Uhr hat kein Mikrofon",
    [STR_TOUCH_OFF] = "Touch ist aus. Oben/Unten für Seiten, Auswahl für OK.",
  },
  [L_NL] = {
    [STR_CONNECTING] = "Verbinden met de telefoon...",
    [STR_BROKEN_LAYOUT] = "Beschadigde lay-out ontvangen",
    [STR_NO_DICTATION] = "Dicteren niet beschikbaar",
    [STR_NO_MIC] = "Dit horloge heeft geen microfoon",
    [STR_TOUCH_OFF] = "Aanraken uit. Omhoog/Omlaag: pagina's, Selecteren: OK.",
  },
  [L_ES] = {
    [STR_CONNECTING] = "Conectando con el teléfono...",
    [STR_BROKEN_LAYOUT] = "Se recibió un diseño dañado",
    [STR_NO_DICTATION] = "Dictado no disponible",
    [STR_NO_MIC] = "Este reloj no tiene micrófono",
    [STR_TOUCH_OFF] = "Táctil apagado. Arriba/Abajo: páginas; Seleccionar: OK.",
  },
  [L_ID] = {
    [STR_CONNECTING] = "Menghubungkan ke ponsel...",
    [STR_BROKEN_LAYOUT] = "Tata letak yang diterima rusak",
    [STR_NO_DICTATION] = "Dikte tidak tersedia",
    [STR_NO_MIC] = "Jam ini tidak punya mikrofon",
    [STR_TOUCH_OFF] = "Sentuh nonaktif. Atas/Bawah: halaman, Pilih: OK.",
  },
};

static int s_setting = -1;  // -1 = automatic
static int s_lang = L_EN;
static uint16_t s_drawable;

static bool fw_at_least(int major, int minor) {
  WatchInfoVersion v = watch_info_get_firmware_version();
  return v.major > major || (v.major == major && v.minor >= minor);
}

// Missing glyphs are drawn as the U+25AF box: compare a 3-letter sample with 3 boxes.
static bool font_has(const char *sample) {
  GFont f = fonts_get_system_font(FONT_KEY_GOTHIC_24);
  GRect box = GRect(0, 0, 180, 60);
  GSize a = graphics_text_layout_get_content_size(sample, f, box, GTextOverflowModeWordWrap, GTextAlignmentLeft);
  GSize b = graphics_text_layout_get_content_size("\xe2\x96\xaf\xe2\x96\xaf\xe2\x96\xaf", f, box,
                                                  GTextOverflowModeWordWrap, GTextAlignmentLeft);
  return a.w > 0 && a.w != b.w;
}

// Language of a locale such as "fr_FR" or "fr", -1 if not supported.
static int lang_index(const char *locale) {
  if (!locale || !locale[0] || !locale[1]) return -1;
  if (locale[2] && locale[2] != '_' && locale[2] != '-') return -1;
  char a = locale[0] | 0x20, b = locale[1] | 0x20;
  if (a == 'i' && b == 'n') return L_ID;  // older code for Indonesian
  for (int i = 0; i < L_COUNT; i++) {
    if (LANG_CODES[i][0] == a && LANG_CODES[i][1] == b) return i;
  }
  return -1;
}

// Same rule as resolve() in src/pkjs/lib/i18n.js.
static void pick(void) {
  int l = s_setting >= 0 ? s_setting : lang_index(i18n_get_system_locale());
  if (l < 0 || !(s_drawable & (1 << l))) l = L_EN;
  s_lang = l;
}

void i18n_init(void) {
  s_drawable = (1 << L_COUNT) - 1;
  // Arabic needs firmware 4.20+ with an Arabic language pack.
  if (!fw_at_least(4, 20) || !font_has("\xd8\xa8\xd8\xb3\xd9\x85")) s_drawable &= ~(1 << L_AR);
  // Turkish needs ğ, ı and ş, which the base font may not have.
  if (!font_has("\xc4\x9f\xc4\xb1\xc5\x9f")) s_drawable &= ~(1 << L_TR);
  s_setting = persist_exists(KEY_LANG) ? persist_read_int(KEY_LANG) - 1 : -1;
  if (s_setting < -1 || s_setting >= L_COUNT) s_setting = -1;
  pick();
  APP_LOG(APP_LOG_LEVEL_INFO, "language %s (locale %s, fonts 0x%x)", LANG_CODES[s_lang], i18n_get_system_locale(),
          s_drawable);
}

bool i18n_set(const char *setting) {
  int idx = (setting && strlen(setting) == 2) ? lang_index(setting) : -1;
  if (idx != s_setting) {
    s_setting = idx;
    if (idx < 0) persist_delete(KEY_LANG);
    else persist_write_int(KEY_LANG, idx + 1);
  }
  int before = s_lang;
  pick();
  return s_lang != before;
}

uint16_t i18n_drawable(void) {
  return s_drawable;
}

const char *i18n_str(StrId id) {
  if ((unsigned)id >= STR_COUNT) return "";
  const char *s = STRS[s_lang][id];
  return s ? s : STRS[L_EN][id];
}
