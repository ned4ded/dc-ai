/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable camelcase */
// @ts-check
import fetch from "node-fetch";
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { load } from 'cheerio';
import puppeteer from 'puppeteer';
import { parse } from 'date-fns';
import _ from 'lodash'
import hsum from 'hash-sum'

const OPTIONS = {
    useCache: true
}

const DIRNAME = dirname(fileURLToPath(import.meta.url));
const dirs = {
    CACHE: join(DIRNAME, './cache'),
    RESULT: join(DIRNAME, './data'),
    RESULT_SPECS: join(DIRNAME, './data/techpowerup_gpus_specifications.json'),
    RESULT_BENCHMARKS: join(DIRNAME, './data/tomshardware_gpus_benchmarks.json'),
    RESULT_PRICES: join(DIRNAME, './data/pcpartpicker_gpus_prices.json'),
    RESULT_RATINGS: join(DIRNAME, './data/userbenchmark_gpus_rating.json'),
};

if (!existsSync(dirs.CACHE)) await fs.mkdir(dirs.CACHE);
if (!existsSync(dirs.RESULT)) await fs.mkdir(dirs.RESULT);

const CACHE = {
    url2filename: (url) => `${[hsum(url), url.toString().replace(/[<>:"/\\|?*]/g, '_')].join('_')}.html`,
    getFilepathByUrl: (url) => join(dirs.CACHE, CACHE.url2filename(url)),
    saveHtmlInCache: async (url, html) => {
        try {
            const path = CACHE.getFilepathByUrl(url);
            console.log(`[saveHtmlInCache] saving page to ${path}`);
            return await fs.writeFile(path, html);
        } catch (e) {
            console.error('[saveHtmlInCache] can\'t save chief')
            console.error(e);
            return null;
        }
    },
    getCacheOrNull: async (url) => {
        console.log(`[getCacheOrNull] start ${url}`);
        const fileName = CACHE.url2filename(url);
        const filePath = join(dirs.CACHE, fileName);

        if (OPTIONS.useCache && existsSync(filePath)) {
            console.log('[getCacheOrNull] retrieving cached pages');
            const t = (await fs.readFile(filePath)).toString();
            console.log('[getCacheOrNull] done');
            return t;
        }

        console.log('[getCacheOrNull] no cache found, returning');
        return null;
    }
}


const fetchAndSave = async (url) => {
    console.log(`[fetchAndSave] fetching ${url}`);
    const html = await CACHE.getCacheOrNull(url);
    if (html) return html;

    console.log('[fetchAndSave] loading page');
    const d = await fetch(url);
    const text = await d.text();
    CACHE.saveHtmlInCache(url, text);
    console.log('[fetchAndSave] done');
    return text;
}

const DetailsNamesAssoc = {
    "Brand:": "brand",
    "Model:": "model",
    "Memory:": "memory",
    "Memory Interface:": "memory_interface",
    "Length:": "length",
    "Interface:": "interface",
    "Chipset:": "chipset",
    "Base Clock:": "base_clock",
    "Clock Speed:": "clock_speed",
    "Frame Sync:": "frame_sync",
}

const html2json = (html) => {
    const $ = load(html);
    const gpus = $('#myTable .items');
    return gpus.map(function gpusMapper() {
        const details = $(this).find('.detail').map(function detailMapper() {
            const name = $(this).find('.detail__name').text().trim()
            const value = $(this).find('.detail__value').text().trim()
            return { name, value }
        }).get().reduce((acc, { name, value }) => ({ ...acc, [DetailsNamesAssoc[name]]: value }), {});
        const name = $(this).find('.table_title').text();
        const itemUrl = $(this).find('.table_title a').attr()?.href;
        const price = +$(this).find('.price').text().replace(/[^\d.]/g, '');

        return { name, ...details, price, item_url: itemUrl }
    }).get();
}

const URLS = {
    TECHPOWERUP_GPUS_SPECS: 'https://www.techpowerup.com/gpu-specs/',
    TOMSHARDWARE_BENCHMARKS: 'https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html',
    PCPARTPICKER_GPUS_LIST: 'https://pcpartpicker.com/products/video-card/',
};

const RESOURSES = {
    PCPARTPICKER: join(DIRNAME, './resources/pcpartpicker/'),
    USERBENCHMARK: join(DIRNAME, './resources/userbenchmark/'),
}

const randomTimeout = (from, to) => new Promise(res => {
    const ms = _.random(from, to, false);
    console.log(`[randomTimeout] holding breath for ${ms}ms`);
    setTimeout(res, ms)
})

/** @type {import('puppeteer').Browser} */
let browser;
/** @type {import('puppeteer').Page} */
let page;

const scrappers = {
    /**
     * @return {Promise<import('puppeteer').Page>} 
     */
    getPage: async () => {
        if (!browser) {
            browser = await puppeteer.launch({ headless: false });
        }
        if (!page) {
            page = await browser.newPage();
            await page.setViewport({ width: 1600, height: 900 });
            await page.setBypassCSP(true);
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0')
            await page.setCookie({
                'domain': '.pcpartpicker.com',
                name: 'cf_clearance',
                value: 'w.7pzSg0O6YsZpU8l6mhZ.lMCh5HcnSzqiMXElw2glI-1700629269-0-1-79ba6542.83a555d2.2868fde8-160.2.1700629269',
                httpOnly: true,
                secure: true,
                sameSite: "None",
                path: "/",
            },
                {
                    domain: 'pcpartpicker.com',
                    name: 'xcsrftoken',
                    value: '3q0tmDvuAGmtL2TvjgswBRPVV3dR27ybdlBMq60DgK9LBi3uCp4Imq8TpYxTy6qC',
                    httpOnly: false,
                    secure: false,
                    sameSite: "Lax",
                })
        }
        return page
    },
    /**
     * @param {*} url - string
     * @return {Promise<[boolean, string]>} - [isFromCache, theHtml] 
     */
    getHtml: async (url) => {
        console.log(`[getHtml]: start getting ${url}`)
        const html = await CACHE.getCacheOrNull(url);
        if (html) return [true, html];
        console.log('[getHtml]: scrapping')
        const p = await scrappers.getPage();
        await p.goto(url);
        await p.waitForNetworkIdle();
        const theHtml = await p.content();
        CACHE.saveHtmlInCache(url, theHtml);
        console.log('[getHtml]: done')
        return [false, theHtml];
    },

    /**
     * @param {string} value
     * @return {Promise<[boolean, string]>} - [isFromCache, theHtml] 
     */
    getGpusByGeneration: async (value) => {
        console.log(`[getGpusByGeneration]: start generation ${value}`);
        const url = new URL(`${URLS.TECHPOWERUP_GPUS_SPECS}?mobile=No&igp=No&sort=name`);
        url.searchParams.append('generation', value);
        url.toString();

        const html = await CACHE.getCacheOrNull(url.toString());
        if (html) return [true, html];

        console.log('[getGpusByGeneration]: scrapping')
        const p = await scrappers.getPage();
        const isSameUrl = p.url().startsWith(URLS.TECHPOWERUP_GPUS_SPECS);

        if (!isSameUrl) {
            await p.goto(url.toString());
        }
        // ?? пользак пару сек аутирует, чтобы найти фильтры
        await randomTimeout(1000, 3000);
        await page.waitForSelector('#generation');
        // ?? Пользак выбирает фильтр по поколениям, очищает значения
        await page.select('#generation', '');
        await p.waitForNetworkIdle();
        // ?? Пользак аутирует пару сек, чтоб выбрать нужное поколение
        await randomTimeout(1000, 3000);
        await page.waitForSelector('#generation');
        // ?? Пользак выбирает нужно поколение
        await page.select('#generation', value);
        await p.waitForNetworkIdle();
        // ?? Пользак анализирует данные
        await randomTimeout(3000, 5000);
        const theHtml = await p.content();
        CACHE.saveHtmlInCache(url.toString(), theHtml);
        console.log('[getGpusByGeneration]: done')
        return [false, theHtml];
    },
}

const parsers = {
    getText: (v) => load(v).text().trim(),

    /**
     * @param {string} html - https://www.techpowerup.com/gpu-specs/ html
     * @return {{'value': string, 'count': number}[]};
     */
    getTpuOptionsListById: (html) => {
        const $ = load(html);
        // Надо выбрать тот набор фильтров, который позволит выгружать по 100 штук за раз, это ограничение TPU
        return $(`#generation option`).toArray().map((element) => ({
            value: element.attribs.value ?? null,
            count: element.attribs.value ? Number($(element).text()?.match(/\((\d+)\)/g)?.map(m => m?.match(/\d+/)?.[0])) : 0,
        })).filter(v => v.value);
    },

    /**
     * @param {string} html - https://www.techpowerup.com/gpu-specs/ html
     */
    getTpuProcessors: (html) => {
        const $ = load(html);
        const $table = $('.processors');
        const headings = $table.find('thead').toArray().filter((v, i) => i % 2 === 0);

        const tbodies = $table.find('tbody').toArray().map((tbody, i) => {
            const rows = $(tbody).find('tr');
            return rows.toArray().map(v => {
                const values = $(v).find('td');
                const [memory_size, memory_type, memory_bus] = parsers.getText(values.get(4)).split(',').map(s => s.trim());
                return {
                    manufacturer: parsers.getText(headings[i]),
                    model_name: parsers.getText(values.get(0)),
                    url: `https://www.techpowerup.com${$(values.get(0)).find('a').attr('href')}`,
                    chip: parsers.getText(values.get(1)),
                    release_date: parse(parsers.getText(values.get(2)), "MMM do, yyyy", new Date()),
                    bus_interface: parsers.getText(values.get(3)),
                    memory_size,
                    memory_type,
                    memory_bus,
                    gpu_clock: parsers.getText(values.get(5)),
                    memory_clock: parsers.getText(values.get(6)),
                }
            })
        })

        return _.flatten(tbodies);
    },

    getFps: (e) => Number(parsers.getText(e)?.match(/\((\d+\.\d+)fps\)/)?.[0]?.match(/\d+\.\d+/)?.[0]),

    getThwBenchmarks: (html) => {
        const $ = load(html);
        const $rows = $('#slice-container-table-L8SfcAV5o28ayEFjzq6cfX-13 .table__container tbody > .table__body__row');
        return $rows.toArray().map(i => {
            const $d = $(i).find('td');

            return {
                model_name: parsers.getText($d.get(0)).replace(/[\s\xA0]+/g, ' ').trim(),
                '1080p_ultra': parsers.getFps($d.get(2)),
                '1080p_medium': parsers.getFps($d.get(3)),
                '1440p_ultra': parsers.getFps($d.get(4)),
                '4k_ultra': parsers.getFps($d.get(5)),
            }
        })
    },

    getPppPrices: (html) => {
        const $ = load(html);
        const $rows = $('#category_content > tr');
        return $rows.toArray().map(element => {
            const $element = $(element);
            const product_name = parsers.getText($element.find('.td__name .td__nameWrapper p').text());
            const model_name = $element.find('.td__spec--1').text().replace('Chipset', '');
            const price = Number(parsers.getText($element.find('.td__price').get(0)).replace('Add', '').replace(/[^\d.]/g, ''));
            return { product_name, model_name, price }
        });
    },

    getUbmRatings: (html) => {
        const $ = load(html);
        const $rows = $('.table.mh-td.table-v-center.table-h-center tbody > tr');
        return $rows.toArray().map(element => {
            const $element = $(element);
            const model_name = parsers.getText($element.find('td').get(2));
            const rating = Number($element.find('td:nth-child(4) > div:first').text().trim().replace(/[^\d.]/g, ''));
            const price = Number($element.find('td:nth-child(9) > div:first').text().trim().replace(/[^\d.]/g, ''));
            return { model_name, rating, price }
        });
    }
};

const fetchAndSaveGpuSpecifications = async () => {
    const [, tpuSpecsGenericPageHtml] = await scrappers.getHtml(`${URLS.TECHPOWERUP_GPUS_SPECS}?mobile=No&igp=No&sort=name`);

    const gpuGenerationsList = parsers.getTpuOptionsListById(tpuSpecsGenericPageHtml);

    let gpus = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const [index, generation] of gpuGenerationsList.entries()) {

        console.log(`[fetchAndSaveGpuSpecifications]: done ${index + 1} / ${gpuGenerationsList.length}`);
        console.log(`[fetchAndSaveGpuSpecifications]: starting to process generation ${generation.value}`);
        console.log(`[fetchAndSaveGpuSpecifications]: expect to receive ${generation.count} rows`);
        const [, tpuSpecsPageWithGenerationFilterHtml] = await scrappers.getGpusByGeneration(generation.value);
        const rows = parsers.getTpuProcessors(tpuSpecsPageWithGenerationFilterHtml);
        if (rows.length !== generation.count) {
            // console.error(`[fetchAndSaveGpuSpecifications]: expected to receive ${generation.count} rows, received ${rows.length}`);
            throw new Error(`[fetchAndSaveGpuSpecifications]: expected to receive ${generation.count} rows, received ${rows.length}`);
            // await new Promise(res => {setTimeout(res, 600000)
            // });
        } else {
            console.log(`[fetchAndSaveGpuSpecifications]: received ${rows.length} rows, ok to proceed`);
        }
        gpus = gpus.concat(rows);
    }

    await fs.writeFile(dirs.RESULT_SPECS, JSON.stringify(gpus, null, 2))
    console.log(`[script] GPUs specifications has been parsed successfully. Count: ${gpus.length}.`);
}

const fetchAndSaveGpuBenchmarks = async () => {
    console.log(`[script] Starting to load GPUs benchmarks.`);
    const html = await fetchAndSave(URLS.TOMSHARDWARE_BENCHMARKS);
    const d = parsers.getThwBenchmarks(html);

    await fs.writeFile(dirs.RESULT_BENCHMARKS, JSON.stringify(d, null, 2))
    console.log(`[script] GPUs benchmarks has been parsed successfully.`);
}

const readFilesInDirAndExecuteFn = async (dir, fn) => {
    console.log(`[readFilesInDirAndExecuteFn] Starting to read ${dir}`);
    const d = await fs.readdir(dir);
    let result = [];
    for (const fileName of d) {
        const content = await fs.readFile(join(dir, fileName));
        const parsed = fn(content.toString());
        result = result.concat(parsed);
    }
    return result;
}

const readAndSaveGpuPrices = async () => {
    // PCPARTPICKER_GPUS_LIST
    console.log(`[script] Starting to load GPUs prices.`);
    // @ts-ignore
    const d = await readFilesInDirAndExecuteFn(RESOURSES.PCPARTPICKER, parsers.getPppPrices);
    await fs.writeFile(dirs.RESULT_PRICES, JSON.stringify(d, null, 2))
    console.log(`[script] GPUs prices has been parsed successfully.`);
}

const readAndSaveGpuRatings = async () => {
    // PCPARTPICKER_GPUS_LIST
    console.log(`[script] Starting to load GPUs ratings.`);
    // @ts-ignore
    const d = await readFilesInDirAndExecuteFn(RESOURSES.USERBENCHMARK, parsers.getUbmRatings);
    await fs.writeFile(dirs.RESULT_RATINGS, JSON.stringify(d, null, 2))
    console.log(`[script] GPUs ratings has been parsed successfully.`);
}

(async () => {
    // https://www.techpowerup.com/gpu-specs/?mobile=No&igp=No&sort=name
    await fetchAndSaveGpuSpecifications();

    // https://www.tomshardware.com/reviews/gpu-hierarchy,4388.html
    await fetchAndSaveGpuBenchmarks();

    // https://pcpartpicker.com/products/video-card/
    await readAndSaveGpuPrices();

    // https://gpu.userbenchmark.com/
    await readAndSaveGpuRatings();

    // const url = 'https://pcbuilder.net/product/graphics-card/';
    // const text = await fetchAndSave(url);
    // const json = html2json(text);
    // await fs.writeFile(join(dirs.RESULT, './pcbuilder_gpus_current.json'), JSON.stringify(json, null, 2));

    // @ts-ignore
    if (browser) await browser.close()
    console.log('[script] the END');
})()

