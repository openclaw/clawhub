import { defineEventHandler } from "h3";
import {
  ANALYTICS_POLICY_VERSION,
  type AnalyticsRegionClass,
} from "../../src/lib/analyticsConsent";

const OPT_IN = new Set(
  "AT AX BE BG CH CY CZ DE DK EE ES FI FR GB GF GP GR HR HU IE IS IT LI LT LU LV MF MQ MT NL NO PL PT RE RO SE SI SK YT".split(
    " ",
  ),
);
// ISO 3166-1 assigned codes only: reserved/unknown provider values must fail closed.
const COUNTRIES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);

export function classifyAnalyticsRegion(
  country: string | null,
  env: { VERCEL?: string },
): AnalyticsRegionClass {
  if (env.VERCEL !== "1" || !country || !COUNTRIES.has(country)) return "unknown";
  return OPT_IN.has(country) ? "opt_in" : "notice_opt_out";
}

export default defineEventHandler((event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
  if (event.req.method !== "GET")
    return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
  return new Response(
    JSON.stringify({
      schema_version: 1,
      policy_version: ANALYTICS_POLICY_VERSION,
      region_class: classifyAnalyticsRegion(
        event.req.headers.get("x-vercel-ip-country"),
        process.env,
      ),
    }),
    { headers },
  );
});
