import express from 'express';
import cron from 'node-cron';
import { supabaseAdmin } from '../supabaseAdmin.js';

const router = express.Router();

const CACHE_KEY_RATES = 'global_exchange_rates';
const CACHE_KEY_DICT = 'global_currencies_dictionary';
const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours

// Mutex locks to prevent duplicate simultaneous fetches (e.g. from React Strict Mode)
let ratesFetchPromise = null;
let dictFetchPromise = null;

const fetchRatesFromApi = async () => {
    // 1. Fetch from API
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    const url = apiKey ? `https://api.currencyapi.com/v3/latest?apikey=${apiKey}` : 'https://open.er-api.com/v6/latest/INR';
    
    const apiRes = await fetch(url);
    if (!apiRes.ok) throw new Error('Failed to fetch from external API');
    const data = await apiRes.json();

    let apiRates = {};
    if (data.data) {
        Object.keys(data.data).forEach(k => apiRates[k] = data.data[k].value);
    } else {
        apiRates = data.rates || data.conversion_rates;
    }

    if (!apiRates || Object.keys(apiRates).length === 0) throw new Error('No rates found');

    const inrBaseRate = apiRates['INR'] || apiRates['inr'] || 1;
    const fetchedRates = {};
    Object.keys(apiRates).forEach(code => {
        let rawRate = apiRates[code] || apiRates[code.toLowerCase()];
        if (rawRate) {
            fetchedRates[code.toUpperCase()] = rawRate / inrBaseRate;
        }
    });

    // 2. Save to DB
    await supabaseAdmin.from('settings').upsert({
        key: CACHE_KEY_RATES,
        value: fetchedRates,
        updated_at: new Date().toISOString()
    });

    return fetchedRates;
};

const fetchDictFromApi = async () => {
    const apiKey = process.env.EXCHANGE_RATE_API_KEY;
    if (!apiKey) throw new Error('No API key configured');

    const apiRes = await fetch(`https://api.currencyapi.com/v3/currencies?apikey=${apiKey}`);
    if (!apiRes.ok) throw new Error('Failed to fetch dictionary');
    const data = await apiRes.json();

    const generatedDict = {};
    Object.keys(data.data).forEach(code => {
        let symbol = data.data[code].symbol || code;
        if (!data.data[code].symbol) {
            try {
                const parts = new Intl.NumberFormat('en', { style: 'currency', currency: code }).formatToParts(1);
                const sym = parts.find(p => p.type === 'currency');
                if (sym) symbol = sym.value;
            } catch(e) {}
        }
        generatedDict[code] = { symbol, name: data.data[code].name, decimals: 2 };
    });

    // Always merge with our 10 defaults
    const SUPPORTED_CURRENCIES = {
        INR: { symbol: '₹', name: 'Indian Rupee', decimals: 0 },
        USD: { symbol: '$', name: 'US Dollar', decimals: 2 },
        EUR: { symbol: '€', name: 'Euro', decimals: 2 },
        GBP: { symbol: '£', name: 'British Pound', decimals: 2 },
        AED: { symbol: 'AED ', name: 'UAE Dirham', decimals: 2 },
        SAR: { symbol: 'SR ', name: 'Saudi Riyal', decimals: 2 },
        CAD: { symbol: 'C$', name: 'Canadian Dollar', decimals: 2 },
        AUD: { symbol: 'A$', name: 'Australian Dollar', decimals: 2 },
        JPY: { symbol: '¥', name: 'Japanese Yen', decimals: 0 },
        SGD: { symbol: 'S$', name: 'Singapore Dollar', decimals: 2 }
    };
    
    Object.keys(SUPPORTED_CURRENCIES).forEach(c => {
        if (generatedDict[c]) {
            generatedDict[c].decimals = SUPPORTED_CURRENCIES[c].decimals;
        } else {
            generatedDict[c] = SUPPORTED_CURRENCIES[c];
        }
    });

    await supabaseAdmin.from('settings').upsert({
        key: CACHE_KEY_DICT,
        value: generatedDict,
        updated_at: new Date().toISOString()
    });

    return generatedDict;
};

router.get('/rates', async (req, res) => {
    try {
        const { data: ratesSetting } = await supabaseAdmin.from('settings').select('*').eq('key', CACHE_KEY_RATES).maybeSingle();
        
        let needsRefresh = true;
        if (ratesSetting && ratesSetting.value) {
            const lastUpdated = new Date(ratesSetting.updated_at).getTime();
            if (Date.now() - lastUpdated < CACHE_DURATION) {
                needsRefresh = false;
                const { data: forceRefresh } = await supabaseAdmin.from('settings').select('*').eq('key', 'force_rates_refresh_timestamp').maybeSingle();
                if (forceRefresh && forceRefresh.value && Number(forceRefresh.value) > lastUpdated) {
                    needsRefresh = true;
                }
            }
        }

        if (!needsRefresh) {
            return res.json(ratesSetting.value);
        }

        // Mutex Lock - Wait for ongoing fetch or start a new one
        if (!ratesFetchPromise) {
            ratesFetchPromise = fetchRatesFromApi().finally(() => {
                ratesFetchPromise = null; // Clear lock when done
            });
        }
        
        const fetchedRates = await ratesFetchPromise;
        res.json(fetchedRates);
    } catch (err) {
        console.error('Rates fetch error:', err);
        const { data } = await supabaseAdmin.from('settings').select('*').eq('key', CACHE_KEY_RATES).maybeSingle();
        if (data && data.value) return res.json(data.value);
        res.status(500).json({ error: 'Failed to fetch rates' });
    }
});

router.get('/dictionary', async (req, res) => {
    try {
        const { data: dictSetting } = await supabaseAdmin.from('settings').select('*').eq('key', CACHE_KEY_DICT).maybeSingle();
        
        let needsRefresh = true;
        if (dictSetting && dictSetting.value && Object.keys(dictSetting.value).length > 0) {
            const lastUpdated = new Date(dictSetting.updated_at).getTime();
            if (Date.now() - lastUpdated < 30 * 24 * 60 * 60 * 1000) {
                needsRefresh = false;
            }
        }

        if (!needsRefresh) {
            return res.json(dictSetting.value);
        }

        if (!dictFetchPromise) {
            dictFetchPromise = fetchDictFromApi().finally(() => {
                dictFetchPromise = null;
            });
        }

        const generatedDict = await dictFetchPromise;
        res.json(generatedDict);
    } catch (err) {
        console.error('Dictionary fetch error:', err);
        const { data } = await supabaseAdmin.from('settings').select('*').eq('key', CACHE_KEY_DICT).maybeSingle();
        if (data && data.value) return res.json(data.value);
        if (err.message === 'No API key configured') return res.status(404).json({ error: err.message });
        res.status(500).json({ error: 'Failed to fetch dictionary' });
    }
});

// Setup Cron Jobs (Runs at 00:00 and 12:00 automatically)
cron.schedule('0 0,12 * * *', async () => {
    console.log('Running automated currency caching job (00:00 / 12:00)...');
    try {
        if (!ratesFetchPromise) {
            ratesFetchPromise = fetchRatesFromApi().finally(() => { ratesFetchPromise = null; });
            await ratesFetchPromise;
            console.log('Automated rates cache successful.');
        }
    } catch (error) {
        console.error('Automated rates cache failed:', error.message);
    }
});

export default router;
