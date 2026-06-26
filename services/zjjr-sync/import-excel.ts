/**
 * 中鉴数据 Excel 批量导入
 * 执行前设置环境变量：
 *   export ZJJR_SYNC_DATABASE_URL="postgresql://zjjr_sync:xxx@localhost:5432/aivestor_db"
 *   export BAILIAN_API_KEY="xxx"
 * 执行：
 *   npx ts-node services/zjjr-sync/import-excel.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';
import { Pool } from 'pg';

// ── 配置 ────────────────────────────────────────────────
const ZIP_FILES = [
  '/var/www/aivestor-app/data/zjjr/zjjr_zhejiang.zip',
  '/var/www/aivestor-app/data/zjjr/zjjr_shanghai.zip',
];
const DB_URL = process.env.ZJJR_SYNC_DATABASE_URL || process.env.DATABASE_URL;
const BAILIAN_KEY = process.env.BAILIAN_API_KEY;
const BATCH = 200;

// ── 工具函数 ─────────────────────────────────────────────

function md5(s: string) {
  return crypto.createHash('md5').update(s).digest('hex');
}

function parseDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  const s = String(v).trim().substring(0, 10);
  return s.match(/^\d{4}-\d{2}-\d{2}$/) ? s : null;
}

function parseNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function firstVal(v: any): string | null {
  if (!v) return null;
  return String(v).split(/[,，;；]/)[0].trim() || null;
}

function classifyFile(filename: string): {
  type: 'gp' | 'lp' | 'portfolio' | null;
  region: string;
  cityDistrict: string;
} {
  let region = '未知';
  const zjCities = ['杭州','湖州','嘉兴','金华','丽水','宁波','衢州','绍兴','台州','温州','舟山'];
  const shDistricts = ['宝山','崇明','奉贤','虹口','黄浦','嘉定','金山','静安','闵行','浦东','普陀','青浦','松江','徐汇','杨浦','长宁'];

  if (filename.includes('浙江') || zjCities.some(c => filename.includes(c))) region = '浙江';
  else if (filename.includes('上海') || shDistricts.some(c => filename.includes(c))) region = '上海';

  let cityDistrict = '';
  for (const c of zjCities) {
    if (filename.includes(c)) { cityDistrict = c; break; }
  }
  if (!cityDistrict) {
    for (const d of shDistricts) {
      if (filename.includes(d)) {
        cityDistrict = filename.includes(d + '新区') ? d + '新区' : d + '区';
        break;
      }
    }
  }

  if (filename.includes('管理人筛选')) return { type: 'gp', region, cityDistrict };
  if (filename.includes('LP筛选')) return { type: 'lp', region, cityDistrict };
  if (filename.includes('被投标的')) return { type: 'portfolio', region, cityDistrict };
  return { type: null, region, cityDistrict };
}

// ── GP 导入 ──────────────────────────────────────────────

async function importGP(pool: Pool, dataRows: any[][], region: string) {
  let ok = 0, skip = 0;
  for (let i = 0; i < dataRows.length; i += BATCH) {
    const batch = dataRows.slice(i, i + BATCH);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of batch) {
        const [name, scaleRange, instType, fundRatioStr, recent30d, awardCount,
               staffCount, directInvest, estDate, regDate, paidCapital,
               controller, aum, regLocation, phone, email] = row;
        if (!name) { skip++; continue; }

        const nameStr = String(name).trim();
        const sourceId = md5(`gp:${nameStr}:${region}`);
        const fundRunning = fundRatioStr ? parseInt(String(fundRatioStr).split('/')[0]) || null : null;
        const fundTotal   = fundRatioStr ? parseInt(String(fundRatioStr).split('/')[1]) || null : null;

        await client.query(`
          INSERT INTO zjjr_institutions (
            source_id, name, canonical_name, institution_type,
            fund_count, manage_scale, region,
            focus_sectors, focus_stages, aliases,
            raw, metadata, source_updated_at
          ) VALUES ($1,$2,$2,$3,$4,$5,$6,'[]','[]','[]',$7,$8,$9)
          ON CONFLICT (source_id) DO UPDATE SET
            manage_scale        = EXCLUDED.manage_scale,
            fund_count          = EXCLUDED.fund_count,
            raw                 = EXCLUDED.raw,
            metadata            = EXCLUDED.metadata,
            source_updated_at   = EXCLUDED.source_updated_at,
            updated_at          = NOW()
        `, [
          sourceId, nameStr, instType,
          fundRunning, scaleRange, region,
          JSON.stringify({
            established_date: parseDate(estDate),
            registered_date:  parseDate(regDate),
            paid_capital:     parseNum(paidCapital),
            controller:       controller || null,
            aum:              parseNum(aum),
            phone:            firstVal(phone),
            email:            firstVal(email),
            recent_30d_issuance: parseNum(recent30d),
            fund_total:       fundTotal,
            award_count:      parseNum(awardCount),
            staff_count:      parseNum(staffCount),
            direct_invest_count: parseNum(directInvest),
          }),
          JSON.stringify({
            award_count:         parseNum(awardCount),
            staff_count:         parseNum(staffCount),
            direct_invest_count: parseNum(directInvest),
            controller:          controller || null,
          }),
          parseDate(regDate) || new Date().toISOString().split('T')[0],
        ]);
        ok++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.log(`  GP [${region}] ${Math.min(i + BATCH, dataRows.length)}/${dataRows.length} 行`);
  }
  console.log(`  GP [${region}] 完成：写入${ok}，跳过${skip}`);
}

// ── LP 导入 ──────────────────────────────────────────────

async function importLP(pool: Pool, dataRows: any[][], region: string) {
  let ok = 0;
  for (let i = 0; i < dataRows.length; i += BATCH) {
    const batch = dataRows.slice(i, i + BATCH);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const row of batch) {
        const [name, committedAmount, fundCount, estDate, regCapital, latestInvestDate, regLocation] = row;
        if (!name) continue;
        await client.query(`
          INSERT INTO zjjr_lp
            (region, name, committed_amount_yuan, fund_count,
             established_date, registered_capital_wan, latest_invest_date, register_location)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT DO NOTHING
        `, [
          region, String(name).trim(),
          parseNum(committedAmount), parseNum(fundCount),
          parseDate(estDate), parseNum(regCapital),
          parseDate(latestInvestDate), regLocation || null,
        ]);
        ok++;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.log(`  LP [${region}] ${Math.min(i + BATCH, dataRows.length)}/${dataRows.length} 行`);
  }
  console.log(`  LP [${region}] 完成：${ok} 条`);
}

// ── 被投标的导入 ──────────────────────────────────────────

async function importPortfolio(pool: Pool, dataRows: any[][], region: string, cityDistrict: string) {
  // 按标的名分组（同一标的多个GP→多行，合并为一个portfolio + 多条investment）
  const portfolioMap = new Map<string, {
    data: any;
    gps: Array<{ gpName: string; fundName: string | null; investDate: string | null }>;
  }>();

  for (const row of dataRows) {
    const [name, , industry, estDate, gpName, fundName,
           latestInvestDate, address, , , regLocation,
           listingStatus, round, legalRep, bizScope, patentName] = row;
    if (!name) continue;
    const key = String(name).trim();
    if (!portfolioMap.has(key)) {
      portfolioMap.set(key, {
        data: { name: key, industry, estDate, address,
                regLocation, listingStatus, round, legalRep, bizScope, patentName,
                latestInvestDate },
        gps: [],
      });
    }
    if (gpName) {
      portfolioMap.get(key)!.gps.push({
        gpName: String(gpName).trim(),
        fundName: fundName ? String(fundName).trim() : null,
        investDate: parseDate(latestInvestDate),
      });
    }
  }

  console.log(`  Portfolio [${region}/${cityDistrict}] 去重后 ${portfolioMap.size} 家标的`);

  let count = 0;
  for (const [, { data, gps }] of portfolioMap) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 写标的主表
      const res = await client.query(`
        INSERT INTO zjjr_portfolio
          (region, city_district, name, industry, established_date,
           address, register_location, listing_status,
           legal_rep, business_scope, patent_name, latest_invest_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        region, cityDistrict, data.name,
        data.industry || null,
        parseDate(data.estDate),
        data.address || null,
        data.regLocation || null,
        data.listingStatus || null,
        data.legalRep || null,
        data.bizScope ? String(data.bizScope).substring(0, 500) : null,
        data.patentName || null,
        parseDate(data.latestInvestDate),
      ]);

      // 写投资关系（zjjr_investments）
      if (res.rows.length > 0) {
        for (const gp of gps) {
          const instRes = await client.query(
            `SELECT id FROM zjjr_institutions WHERE name = $1 AND region = $2 LIMIT 1`,
            [gp.gpName, region]
          );
          if (instRes.rows.length === 0) continue;

          const instId = instRes.rows[0].id;
          const sourceId = md5(`inv:${instId}:${data.name}:${gp.fundName || ''}`);

          await client.query(`
            INSERT INTO zjjr_investments
              (source_id, institution_id, target_company, sector, stage,
               amount_text, invested_at, co_investors, raw)
            VALUES ($1,$2,$3,$4,$5,$6,$7,'[]','{}')
            ON CONFLICT (source_id) DO NOTHING
          `, [
            sourceId, instId, data.name,
            data.industry || null,
            data.round ? String(data.round).trim() : null,
            gp.fundName,
            gp.investDate,
          ]);
        }
      }

      await client.query('COMMIT');
      count++;
      if (count % 1000 === 0) {
        console.log(`  Portfolio [${region}/${cityDistrict}] ${count}/${portfolioMap.size}`);
      }
    } catch (e) {
      await client.query('ROLLBACK');
      console.warn(`  写入失败：${data.name}`, e);
    } finally {
      client.release();
    }
  }
  console.log(`  Portfolio [${region}/${cityDistrict}] 完成`);
}

// ── 向量化 GP 特征 ────────────────────────────────────────

async function vectorizeFeatures(pool: Pool) {
  console.log('\n[向量化] 开始处理 GP 特征...');
  const { rows: gps } = await pool.query(`
    SELECT i.id, i.name, i.region, i.institution_type, i.manage_scale,
           i.fund_count, i.metadata, i.raw
    FROM zjjr_institutions i
    WHERE NOT EXISTS (
      SELECT 1 FROM zjjr_features f
      WHERE f.institution_id = i.id AND f.feature_kind = 'institution_profile'
    )
  `);

  console.log(`  待向量化：${gps.length} 家 GP`);
  const today = new Date().toISOString().split('T')[0];
  const validUntil = new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0];

  for (let idx = 0; idx < gps.length; idx++) {
    const gp = gps[idx];
    const meta = gp.metadata || {};
    const raw  = gp.raw || {};
    const content = [
      `机构名称：${gp.name}`,
      `所在地区：${gp.region}`,
      `机构类型：${gp.institution_type || '私募股权、创业投资基金管理人'}`,
      `管理规模：${gp.manage_scale || '未披露'}`,
      `运作基金数：${gp.fund_count ?? '未知'}`,
      `获奖次数：${meta.award_count ?? 0}`,
      `从业人员：${meta.staff_count ?? 0}人`,
      `直投标的数：${meta.direct_invest_count ?? 0}个`,
      `实控人：${meta.controller || '未披露'}`,
      raw.established_date ? `成立日期：${raw.established_date}` : '',
    ].filter(Boolean).join('；');

    try {
      const embedding = await getBailianEmbedding(content);
      await pool.query(`
        INSERT INTO zjjr_features
          (feature_kind, institution_id, title, content, embedding,
           data_as_of, valid_until, metadata)
        VALUES ('institution_profile', $1, $2, $3, $4, $5, $6, '{}')
        ON CONFLICT DO NOTHING
      `, [gp.id, gp.name, content, JSON.stringify(embedding), today, validUntil]);
    } catch (e) {
      console.warn(`  向量化跳过：${gp.name}`, (e as Error).message);
    }

    // 每10条暂停100ms，避免百炼 API 限频
    if (idx % 10 === 9) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  console.log(`  向量化完成`);
}

async function getBailianEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${BAILIAN_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text-embedding-v4',
        input: { texts: [text.substring(0, 2048)] },
        parameters: { dimension: 1536 },
      }),
    }
  );
  if (!res.ok) throw new Error(`百炼 API ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return data.output.embeddings[0].embedding;
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  if (!DB_URL) throw new Error('请设置 ZJJR_SYNC_DATABASE_URL');
  if (!BAILIAN_KEY) console.warn('⚠ 未设置 BAILIAN_API_KEY，向量化步骤将跳过');

  const pool = new Pool({ connectionString: DB_URL, max: 5 });

  for (const zipPath of ZIP_FILES) {
    if (!fs.existsSync(zipPath)) {
      console.warn(`\n跳过（文件不存在）：${zipPath}`);
      continue;
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log(`处理：${path.basename(zipPath)}`);
    console.log('='.repeat(60));

    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.endsWith('.xlsx')) continue;

      // GBK 解码文件名
      let filename: string;
      try { filename = Buffer.from(entry.rawEntryName).toString('gbk'); }
      catch { filename = entry.entryName; }
      const shortName = path.basename(filename);

      const { type, region, cityDistrict } = classifyFile(shortName);
      if (!type) { console.log(`跳过：${shortName}`); continue; }

      console.log(`\n▶ ${shortName} | ${type} | ${region} ${cityDistrict}`);

      const buf = entry.getData();
      const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      // 第1行是大标题（如"管理人筛选"），第2行是列名，第3行起是数据
      const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as any[][];
      const dataRows = allRows.slice(2);
      console.log(`  共 ${dataRows.length} 行数据`);

      if (type === 'gp')             await importGP(pool, dataRows, region);
      else if (type === 'lp')        await importLP(pool, dataRows, region);
      else if (type === 'portfolio') await importPortfolio(pool, dataRows, region, cityDistrict);
    }
  }

  // 向量化
  if (BAILIAN_KEY) {
    await vectorizeFeatures(pool);
  } else {
    console.log('\n[向量化] 跳过（无 BAILIAN_API_KEY）');
  }

  // 写同步日志
  await pool.query(`
    INSERT INTO zjjr_sync_log (sync_type, status, message, synced_at)
    VALUES ('excel_import', 'success', '浙江+上海 Excel 批量导入完成', NOW())
  `).catch(() => {/* sync_log 表结构不同时忽略 */});

  // 打印统计
  const { rows: [stats] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM zjjr_institutions) AS gp,
      (SELECT COUNT(*) FROM zjjr_lp)           AS lp,
      (SELECT COUNT(*) FROM zjjr_portfolio)     AS portfolio,
      (SELECT COUNT(*) FROM zjjr_investments)   AS investments,
      (SELECT COUNT(*) FROM zjjr_features WHERE embedding IS NOT NULL) AS vectorized
  `);
  console.log('\n✅ 导入完成');
  console.log(`  GP机构：${stats.gp}  LP：${stats.lp}  标的：${stats.portfolio}  投资关系：${stats.investments}  已向量化：${stats.vectorized}`);

  await pool.end();
}

main().catch(err => { console.error('❌ 导入失败：', err); process.exit(1); });
