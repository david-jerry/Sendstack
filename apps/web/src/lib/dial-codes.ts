/**
 * ISO 3166-1 alpha-2 → ITU country calling code.
 *
 * The only part of a country picker that has to be data. Names come from
 * `Intl.DisplayNames`, which is in every browser this app supports and gives
 * them in the reader's own language for free; flags are computed from the ISO
 * code, because a regional-indicator pair *is* the flag emoji. So this file is
 * the mapping and nothing else — a list of names would go stale in a way
 * `Intl` never does.
 *
 * `libphonenumber-js` was the alternative and would have brought authoritative
 * codes plus per-country length validation, at roughly 80 kB gzipped of
 * metadata. It was not worth it here: the only rule the contact schema
 * enforces is E.164 shape (`+` then 2–15 digits), which needs no metadata, and
 * this is a contact form rather than a phone-number product. If national-format
 * validation is ever wanted, that library is the right answer and this file is
 * what it replaces.
 *
 * Ordered by calling code, then ISO, so `splitE164` resolves a shared code
 * deterministically — see the note there about +1, +7 and +44.
 */

export type Country = {
  /** ISO 3166-1 alpha-2, uppercase. */
  iso: string;
  /** Digits only, no `+`. */
  dial: string;
};

/* prettier-ignore */
export const COUNTRIES: readonly Country[] = [
  { iso: "US", dial: "1" },
  { iso: "AG", dial: "1268" }, { iso: "AI", dial: "1264" }, { iso: "AS", dial: "1684" },
  { iso: "BB", dial: "1246" }, { iso: "BM", dial: "1441" }, { iso: "BS", dial: "1242" },
  { iso: "CA", dial: "1" },    { iso: "DM", dial: "1767" }, { iso: "DO", dial: "1809" },
  { iso: "GD", dial: "1473" }, { iso: "GU", dial: "1671" }, { iso: "JM", dial: "1876" },
  { iso: "KN", dial: "1869" }, { iso: "KY", dial: "1345" }, { iso: "LC", dial: "1758" },
  { iso: "MP", dial: "1670" }, { iso: "MS", dial: "1664" }, { iso: "PR", dial: "1787" },
  { iso: "SX", dial: "1721" }, { iso: "TC", dial: "1649" }, { iso: "TT", dial: "1868" },
  { iso: "VC", dial: "1784" }, { iso: "VG", dial: "1284" }, { iso: "VI", dial: "1340" },

  { iso: "EG", dial: "20" },  { iso: "SS", dial: "211" }, { iso: "MA", dial: "212" },
  { iso: "DZ", dial: "213" }, { iso: "TN", dial: "216" }, { iso: "LY", dial: "218" },
  { iso: "GM", dial: "220" }, { iso: "SN", dial: "221" }, { iso: "MR", dial: "222" },
  { iso: "ML", dial: "223" }, { iso: "GN", dial: "224" }, { iso: "CI", dial: "225" },
  { iso: "BF", dial: "226" }, { iso: "NE", dial: "227" }, { iso: "TG", dial: "228" },
  { iso: "BJ", dial: "229" }, { iso: "MU", dial: "230" }, { iso: "LR", dial: "231" },
  { iso: "SL", dial: "232" }, { iso: "GH", dial: "233" }, { iso: "NG", dial: "234" },
  { iso: "TD", dial: "235" }, { iso: "CF", dial: "236" }, { iso: "CM", dial: "237" },
  { iso: "CV", dial: "238" }, { iso: "ST", dial: "239" }, { iso: "GQ", dial: "240" },
  { iso: "GA", dial: "241" }, { iso: "CG", dial: "242" }, { iso: "CD", dial: "243" },
  { iso: "AO", dial: "244" }, { iso: "GW", dial: "245" }, { iso: "IO", dial: "246" },
  { iso: "SC", dial: "248" }, { iso: "SD", dial: "249" }, { iso: "RW", dial: "250" },
  { iso: "ET", dial: "251" }, { iso: "SO", dial: "252" }, { iso: "DJ", dial: "253" },
  { iso: "KE", dial: "254" }, { iso: "TZ", dial: "255" }, { iso: "UG", dial: "256" },
  { iso: "BI", dial: "257" }, { iso: "MZ", dial: "258" }, { iso: "ZM", dial: "260" },
  { iso: "MG", dial: "261" }, { iso: "RE", dial: "262" }, { iso: "ZW", dial: "263" },
  { iso: "NA", dial: "264" }, { iso: "MW", dial: "265" }, { iso: "LS", dial: "266" },
  { iso: "BW", dial: "267" }, { iso: "SZ", dial: "268" }, { iso: "KM", dial: "269" },
  { iso: "ZA", dial: "27" },  { iso: "SH", dial: "290" }, { iso: "ER", dial: "291" },
  { iso: "AW", dial: "297" }, { iso: "FO", dial: "298" }, { iso: "GL", dial: "299" },

  { iso: "GR", dial: "30" },  { iso: "NL", dial: "31" },  { iso: "BE", dial: "32" },
  { iso: "FR", dial: "33" },  { iso: "ES", dial: "34" },  { iso: "GI", dial: "350" },
  { iso: "PT", dial: "351" }, { iso: "LU", dial: "352" }, { iso: "IE", dial: "353" },
  { iso: "IS", dial: "354" }, { iso: "AL", dial: "355" }, { iso: "MT", dial: "356" },
  { iso: "CY", dial: "357" }, { iso: "FI", dial: "358" }, { iso: "BG", dial: "359" },
  { iso: "HU", dial: "36" },  { iso: "LT", dial: "370" }, { iso: "LV", dial: "371" },
  { iso: "EE", dial: "372" }, { iso: "MD", dial: "373" }, { iso: "AM", dial: "374" },
  { iso: "BY", dial: "375" }, { iso: "AD", dial: "376" }, { iso: "MC", dial: "377" },
  { iso: "SM", dial: "378" }, { iso: "VA", dial: "379" }, { iso: "UA", dial: "380" },
  { iso: "RS", dial: "381" }, { iso: "ME", dial: "382" }, { iso: "XK", dial: "383" },
  { iso: "HR", dial: "385" }, { iso: "SI", dial: "386" }, { iso: "BA", dial: "387" },
  { iso: "MK", dial: "389" }, { iso: "IT", dial: "39" },

  { iso: "RO", dial: "40" },  { iso: "CH", dial: "41" },  { iso: "CZ", dial: "420" },
  { iso: "SK", dial: "421" }, { iso: "LI", dial: "423" }, { iso: "AT", dial: "43" },
  { iso: "GB", dial: "44" },  { iso: "GG", dial: "44" },  { iso: "IM", dial: "44" },
  { iso: "JE", dial: "44" },  { iso: "DK", dial: "45" },  { iso: "SE", dial: "46" },
  { iso: "NO", dial: "47" },  { iso: "SJ", dial: "47" },  { iso: "PL", dial: "48" },
  { iso: "DE", dial: "49" },

  { iso: "FK", dial: "500" }, { iso: "BZ", dial: "501" }, { iso: "GT", dial: "502" },
  { iso: "SV", dial: "503" }, { iso: "HN", dial: "504" }, { iso: "NI", dial: "505" },
  { iso: "CR", dial: "506" }, { iso: "PA", dial: "507" }, { iso: "PM", dial: "508" },
  { iso: "HT", dial: "509" }, { iso: "PE", dial: "51" },  { iso: "MX", dial: "52" },
  { iso: "CU", dial: "53" },  { iso: "AR", dial: "54" },  { iso: "BR", dial: "55" },
  { iso: "CL", dial: "56" },  { iso: "CO", dial: "57" },  { iso: "VE", dial: "58" },
  { iso: "BL", dial: "590" }, { iso: "GP", dial: "590" }, { iso: "MF", dial: "590" },
  { iso: "BO", dial: "591" }, { iso: "GY", dial: "592" }, { iso: "EC", dial: "593" },
  { iso: "GF", dial: "594" }, { iso: "PY", dial: "595" }, { iso: "MQ", dial: "596" },
  { iso: "SR", dial: "597" }, { iso: "UY", dial: "598" }, { iso: "CW", dial: "599" },

  { iso: "MY", dial: "60" },  { iso: "AU", dial: "61" },  { iso: "CX", dial: "61" },
  { iso: "ID", dial: "62" },  { iso: "PH", dial: "63" },  { iso: "NZ", dial: "64" },
  { iso: "SG", dial: "65" },  { iso: "TH", dial: "66" },  { iso: "TL", dial: "670" },
  { iso: "NF", dial: "672" }, { iso: "BN", dial: "673" }, { iso: "NR", dial: "674" },
  { iso: "PG", dial: "675" }, { iso: "TO", dial: "676" }, { iso: "SB", dial: "677" },
  { iso: "VU", dial: "678" }, { iso: "FJ", dial: "679" }, { iso: "PW", dial: "680" },
  { iso: "WF", dial: "681" }, { iso: "CK", dial: "682" }, { iso: "NU", dial: "683" },
  { iso: "WS", dial: "685" }, { iso: "KI", dial: "686" }, { iso: "NC", dial: "687" },
  { iso: "TV", dial: "688" }, { iso: "PF", dial: "689" }, { iso: "TK", dial: "690" },
  { iso: "FM", dial: "691" }, { iso: "MH", dial: "692" },

  { iso: "RU", dial: "7" },   { iso: "KZ", dial: "7" },

  { iso: "JP", dial: "81" },  { iso: "KR", dial: "82" },  { iso: "VN", dial: "84" },
  { iso: "KP", dial: "850" }, { iso: "HK", dial: "852" }, { iso: "MO", dial: "853" },
  { iso: "KH", dial: "855" }, { iso: "LA", dial: "856" }, { iso: "CN", dial: "86" },
  { iso: "BD", dial: "880" }, { iso: "TW", dial: "886" },

  { iso: "TR", dial: "90" },  { iso: "IN", dial: "91" },  { iso: "PK", dial: "92" },
  { iso: "AF", dial: "93" },  { iso: "LK", dial: "94" },  { iso: "MM", dial: "95" },
  { iso: "MV", dial: "960" }, { iso: "LB", dial: "961" }, { iso: "JO", dial: "962" },
  { iso: "SY", dial: "963" }, { iso: "IQ", dial: "964" }, { iso: "KW", dial: "965" },
  { iso: "SA", dial: "966" }, { iso: "YE", dial: "967" }, { iso: "OM", dial: "968" },
  { iso: "PS", dial: "970" }, { iso: "AE", dial: "971" }, { iso: "IL", dial: "972" },
  { iso: "BH", dial: "973" }, { iso: "QA", dial: "974" }, { iso: "BT", dial: "975" },
  { iso: "MN", dial: "976" }, { iso: "NP", dial: "977" }, { iso: "IR", dial: "98" },
  { iso: "TJ", dial: "992" }, { iso: "TM", dial: "993" }, { iso: "AZ", dial: "994" },
  { iso: "GE", dial: "995" }, { iso: "KG", dial: "996" }, { iso: "UZ", dial: "998" },
];

/**
 * The flag, computed rather than stored.
 *
 * An ISO alpha-2 code maps letter-for-letter onto the Unicode regional
 * indicator block, so `GB` *is* 🇬🇧. Storing 240 emoji literals in a source
 * file invites mojibake through every tool that touches it; two arithmetic
 * operations cannot be mangled.
 *
 * Falls back to the code itself on a platform with no flag glyphs — Windows
 * has never shipped them, and a blank cell there would leave the picker
 * unreadable.
 */
const REGIONAL_INDICATOR_A = 0x1f1e6;

/**
 * The flag emoji for an ISO code.
 *
 * @param iso ISO 3166-1 alpha-2, uppercase.
 * @returns The regional indicator pair, or `iso` unchanged if it is not a
 *   two-letter code — which is also what renders on a platform with no flag
 *   glyphs, since Windows has never shipped them and a blank cell would leave
 *   the picker unreadable.
 */
export function flagOf(iso: string): string {
  if (!/^[A-Z]{2}$/.test(iso)) return iso;
  return String.fromCodePoint(
    ...[...iso].map((letter) => REGIONAL_INDICATOR_A + letter.charCodeAt(0) - 65),
  );
}

/**
 * The country's name in the reader's language, from the platform.
 *
 * `Intl.DisplayNames` is wrapped because it throws on an unknown region rather
 * than returning undefined, and `XK` — Kosovo, which has a calling code and no
 * ISO assignment — is exactly that case on some runtimes.
 */
export function nameOf(iso: string, locale?: string): string {
  try {
    const display = new Intl.DisplayNames([locale ?? "en"], { type: "region" });
    return display.of(iso) ?? iso;
  } catch {
    return iso;
  }
}

/**
 * Splits an E.164 number into a country and the rest.
 *
 * Longest dial code first, so `+1268` resolves to Antigua rather than to the
 * United States on its shared `+1`. Where a code is genuinely shared between
 * countries — `+1` for the US and Canada, `+7` for Russia and Kazakhstan,
 * `+44` for the UK and the Crown Dependencies — the number alone does not say
 * which, and the first entry in `COUNTRIES` wins. That is a display detail
 * only: both halves are concatenated back into the same string on save, so
 * nothing is lost by guessing wrong.
 */
export function splitE164(value: string): { iso: string; national: string } | null {
  if (!value.startsWith("+")) return null;
  const digits = value.slice(1);

  const byLength = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of byLength) {
    if (digits.startsWith(country.dial)) {
      return { iso: country.iso, national: digits.slice(country.dial.length) };
    }
  }
  return null;
}

/**
 * The calling code for a country.
 *
 * A linear scan rather than a prebuilt map: two hundred entries, called a
 * handful of times per render, and a module-level `Map` would be a second
 * structure to keep in step with the table above for no measurable gain.
 *
 * @param iso ISO 3166-1 alpha-2.
 * @returns Digits with no `+`, or null when the code is unknown.
 */
export function dialOf(iso: string): string | null {
  return COUNTRIES.find((country) => country.iso === iso)?.dial ?? null;
}

/**
 * The country to preselect, guessed from the browser's own locale.
 *
 * A picker that opens on Afghanistan because the list is alphabetical asks
 * everyone to scroll past two hundred entries to reach their own country.
 * `Intl.Locale` exposes the region of `navigator.language`, which is the
 * closest thing to a free right answer — and when it is wrong, or absent, the
 * fallback is the largest single block of subscribers rather than nothing.
 */
export function guessCountry(locale?: string, fallback = "US"): string {
  const tag = locale ?? (typeof navigator === "undefined" ? undefined : navigator.language);
  if (!tag) return fallback;

  try {
    const region = new Intl.Locale(tag).maximize().region;
    if (region && dialOf(region)) return region;
  } catch {
    // A malformed language tag is the browser's problem, not a reason to fail.
  }
  return fallback;
}
