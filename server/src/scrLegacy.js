// Sales Comparison Report — "Old design".
//
// A faithful copy of the original cpanel page (/auth/scr). That page reads the
// MySQL warehouse through the old server's /api/advancemysqlquery endpoint,
// using a handful of named queries plus a few raw SELECTs. This module proxies
// exactly those queries so the copy shows the same numbers.
//
// Safety: the browser never sends SQL. It names one of the queries below and
// passes parameters, which are validated here; the SQL text lives server-side.
// Read-only — no writes are proxied.
//
// The network path to the old server resets any request containing UNION, so
// the two original UNION queries are rewritten below without it (same result).

const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://192.168.0.211:3000';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15_000);

const STORES = ['ARDEN', 'WAYNESVILLE', 'CFC'];
const CATEGORIES = ['Written', 'Delivered'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── SQL copied from the original page ────────────────────────────────────────
// Daily comparison table (the old /_sql/scr.sql file).
const SQL_DAILY = `SELECT
  DATE_FORMAT( STR_TO_DATE( CONCAT(x.\`dayMonth\`, '-', YEAR( CURDATE())), '%d-%M-%Y'), '%d-%b' ) AS \`DayMonth\`,
  DATE_FORMAT( STR_TO_DATE( CONCAT(x.\`dayMonth\`, '-',YEAR( CURDATE())), '%d-%M-%Y' ), '%Y-%m-%d' ) AS \`Dated\`,
  DATE_FORMAT( STR_TO_DATE( CONCAT( x.\`dayMonth\`, '-', YEAR( CURDATE()) -1 ), '%d-%M-%Y' ), '%a' ) AS \`DayLY\`,
  x.\`LastYear\`,
  DATE_FORMAT( STR_TO_DATE( CONCAT( x.\`dayMonth\`, '-', YEAR( CURDATE()) ), '%d-%M-%Y' ), '%a' ) AS \`DayTY\`,
  x.\`ThisYear\`,
  SUM(x.\`ThisYear\`) OVER ( ORDER BY \`Day\` ) AS \`TYR\`, SUM(x.\`LastYear\`) OVER ( ORDER BY \`Day\` ) AS \`LYR\`,
  x.\`Difference\`
FROM (
    SELECT s.\`DayMonth\`, s.\`ThisYear\`, s.\`LastYear\`,
      ( COALESCE(s.\`ThisYear\`, 0) - COALESCE(s.\`LastYear\`, 0) ) AS \`Difference\`,
      DAY( STR_TO_DATE( CONCAT( s.\`DayMonth\`, '-', YEAR( CURDATE() ) ), '%e-%M-%Y' ) ) AS \`Day\`
    FROM \`viewsalesaggrdaywisereport\` s
    WHERE s.\`ProfitCenter\` = ? AND s.\`DayMonth\` LIKE ? AND s.\`SaleCategory\` = ?
  ) x
ORDER BY \`Day\` ASC;`;

const MONTH_ORDER = "FIELD(MonthName, 'January','February','March','April','May','June','July','August','September','October','November','December')";
const sqlFourYears = (cat) => {
  const sfx = cat === 'Written' ? 'W' : 'D';
  return `SELECT MonthName, Previous_${sfx} AS Previous, PreviousYear_${sfx} AS PreviousYear, LastYear_${sfx} AS LastYear, CurrentYear_${sfx} AS ThisYear FROM salesaggrmonthwisereport WHERE ProfitCenter = ? AND SaleCategory_${sfx} = ? ORDER BY ${MONTH_ORDER};`;
};

const SQL_MONTH_TILL_DATE = "SELECT MonthName, LastYear, ThisYear, (ThisYear - LastYear) AS Difference FROM viewsalesaggrmonthwisereport WHERE ProfitCenter = ? AND SaleCategory = ? AND MONTH(STR_TO_DATE(CONCAT('1-', MonthName, '-2025'), '%d-%M-%Y')) <= ? ORDER BY MONTH(STR_TO_DATE(CONCAT('1-', MonthName, '-2025'), '%d-%M-%Y'));";

// Like-for-like month-till-date (both stores share one cut-off day for CFC).
const SQL_MTD_COMPARE_BASE = "SELECT c.`CutOffDay`, SUM(COALESCE(x.`LastYear`, 0)) AS `LastYearMTD`, SUM(COALESCE(x.`ThisYear`, 0)) AS `ThisYearMTD` FROM ( SELECT s.`LastYear`, s.`ThisYear`, DAY(STR_TO_DATE(CONCAT(s.`DayMonth`, '-', YEAR(CURDATE())), '%e-%M-%Y')) AS `Day` FROM `viewsalesaggrdaywisereport` s WHERE s.`ProfitCenter` = ? AND s.`DayMonth` LIKE ? AND s.`SaleCategory` = ? ) x JOIN ( SELECT MAX(DAY(STR_TO_DATE(CONCAT(s.`DayMonth`, '-', YEAR(CURDATE())), '%e-%M-%Y'))) AS `CutOffDay` FROM `viewsalesaggrdaywisereport` s WHERE s.`ProfitCenter` = ? AND s.`DayMonth` LIKE ? AND s.`SaleCategory` = ? AND COALESCE(s.`ThisYear`, 0) <> 0 ) c ON x.`Day` <= c.`CutOffDay` GROUP BY c.`CutOffDay`;";

const SQL_YEARLY = `
        SELECT
            MonthName as \`Month\`,
            LastYear,
            ThisYear,
            ThisYear - LastYear AS \`Diff\`,
            CASE
                WHEN LastYear = 0 THEN 0
                ELSE ROUND(((ThisYear - LastYear) / LastYear) * 100, 2)
            END AS \`Ch(%)\`
        FROM viewsalesaggrmonthwisereport
        WHERE ProfitCenter = ? AND SaleCategory = ?
        ORDER BY FIELD(MonthName,
          'January','February','March','April','May','June',
          'July','August','September','October','November','December');`;

const SQL_TARGET = 'SELECT id, target_amount FROM store_targets WHERE category=? AND profitcenter=? AND target_year=? AND target_month=?';

// ── Parameter validation ─────────────────────────────────────────────────────
class BadParam extends Error {}
const pick = (v, list, name) => { if (!list.includes(v)) throw new BadParam(`invalid ${name}`); return v; };
const store1 = (v) => pick(String(v || '').toUpperCase(), ['ARDEN', 'WAYNESVILLE'], 'store');
const storeAny = (v) => pick(String(v || '').toUpperCase(), STORES, 'store');
const category = (v) => pick(String(v || ''), CATEGORIES, 'category');
const month = (v) => pick(String(v || ''), MONTHS, 'month');
const int = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadParam(`invalid ${name}`);
  return n;
};

// name → (params) → { key, values, qry? } sent to the old endpoint.
const QUERIES = {
  avg: (p) => ({ key: 'avgSalesLyTyMysql', values: [store1(p.store), `%${month(p.month)}`, category(p.category), int(p.day, 0, 31, 'day')] }),
  monthTotal: (p) => ({ key: 'monthTotalLyTyMysql', values: [store1(p.store), `%${month(p.month)}`, category(p.category)] }),
  graph: (p) => ({ key: 'thisMonthComprasionWithLastYearsThisMonthWithRunningTotalForGraph', values: [store1(p.store), `%${month(p.month)}`, category(p.category), int(p.day, 0, 31, 'day')] }),
  weekly: (p) => ({ key: 'weeklySalessummaryMysql', values: [store1(p.store), `%${month(p.month)}`, category(p.category)] }),
  quarter: (p) => ({ key: 'salesQuarterTotalLastAndThisYearMysql', values: [store1(p.store), category(p.category)] }),
  monthwise: () => ({ key: 'salesaggrmonthwisereportMysql', values: [] }),
  daily: (p) => ({ key: 'na', qry: SQL_DAILY, values: [store1(p.store), `%${month(p.month)}`, category(p.category)] }),
  fourYears: (p) => { const c = category(p.category); return { key: 'na', qry: sqlFourYears(c), values: [store1(p.store), c] }; },
  monthTillDate: (p) => {
    const s = store1(p.store), c = category(p.category), m = int(p.monthNumber, 1, 12, 'monthNumber');
    return { key: 'na', qry: SQL_MONTH_TILL_DATE, values: [s, c, m], post: addTotalRow };
  },
  mtdCompare: (p) => {
    const stores = (Array.isArray(p.stores) ? p.stores : []).map(store1);
    if (!stores.length || stores.length > 2) throw new BadParam('invalid stores');
    const ph = stores.map(() => '?').join(', ');
    const qry = SQL_MTD_COMPARE_BASE.split('s.`ProfitCenter` = ?').join(`s.\`ProfitCenter\` IN (${ph})`);
    const mm = `%${month(p.month)}`, c = category(p.category);
    return { key: 'na', qry, values: [...stores, mm, c, ...stores, mm, c] };
  },
  yearly: (p) => ({ key: 'na', qry: SQL_YEARLY, values: [store1(p.store), category(p.category)] }),
  target: (p) => ({ key: 'na', qry: SQL_TARGET, values: [category(p.category), storeAny(p.store), int(p.year, 2000, 2100, 'year'), int(p.month, 1, 12, 'month')] }),
};

// The original query appended a TOTAL row (SUM of each year, Difference = TY − LY).
function addTotalRow(rows) {
  const sum = (k) => rows.reduce((t, r) => t + (parseFloat(r[k]) || 0), 0);
  const ly = Math.round(sum('LastYear') * 100) / 100, ty = Math.round(sum('ThisYear') * 100) / 100;
  return [...rows, { MonthName: 'TOTAL', LastYear: ly, ThisYear: ty, Difference: Math.round((ty - ly) * 100) / 100 }];
}

async function callUpstream(body) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${UPSTREAM_URL}/api/advancemysqlquery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`upstream ${r.status}: ${text.slice(0, 160)}`); }
    if (!r.ok) throw new Error(json?.message || `upstream ${r.status}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export function registerScrLegacy(app) {
  // Read queries.
  app.post('/api/scr-legacy/query', async (req, res) => {
    const { q, params = {} } = req.body ?? {};
    const build = QUERIES[q];
    if (!build) return res.status(400).json({ error: 'unknown query' });
    let body;
    try { body = build(params || {}); } catch (e) {
      return res.status(400).json({ error: e instanceof BadParam ? e.message : 'invalid parameters' });
    }
    try {
      const { post, ...upstreamBody } = body;
      const json = await callUpstream(upstreamBody);
      const rows = Array.isArray(json?.data) ? json.data : [];
      res.json({ rows: post ? post(rows) : rows });
    } catch (err) {
      res.status(502).json({ error: 'upstream error', message: err.message });
    }
  });


}
