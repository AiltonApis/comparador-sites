import express from "express";
import {
    chromium
} from "playwright";
import pixelmatch from "pixelmatch";
import {
    PNG
} from "pngjs";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// 🎯 FUNÇÃO DE CRAWLING (que estava faltando)
// 🎯 FUNÇÃO DE CRAWLING MELHORADA
async function crawlSite(browser, baseUrl, maxPages = 50) {
    const visited = new Set();
    const toVisit = [baseUrl];
    const allPages = new Set([baseUrl]);

    const page = await browser.newPage();

    // Configurações mais permissivas
    await page.setDefaultTimeout(60000);
    await page.setDefaultNavigationTimeout(60000);

    console.log(`🔍 Iniciando crawling em: ${baseUrl}`);

    while (toVisit.length > 0 && allPages.size < maxPages) {
        const currentUrl = toVisit.shift();

        if (visited.has(currentUrl)) continue;

        console.log(`🌐 Crawling: ${currentUrl}`);

        try {
            await page.goto(currentUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            await page.waitForTimeout(3000);
            visited.add(currentUrl);

            // Estratégia SIMPLES que FUNCIONA
            const links = await page.$$eval('a[href]', (anchors, baseUrl) => {
                return anchors
                    .map(a => a.href)
                    .filter(href => {
                        try {
                            if (!href) return false;
                            const baseDomain = new URL(baseUrl).hostname;
                            const linkUrl = new URL(href, baseUrl);
                            return linkUrl.hostname === baseDomain;
                        } catch {
                            return false;
                        }
                    })
                    .map(href => {
                        try {
                            return new URL(href, baseUrl).href;
                        } catch {
                            return null;
                        }
                    })
                    .filter(href => href !== null &&
                        !href.includes('#') &&
                        !href.includes('mailto:') &&
                        !href.includes('tel:') &&
                        !href.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|mp3|mp4)$/i))
                    .slice(0, 50);
            }, baseUrl);

            console.log(`📎 Encontrados ${links.length} links em ${currentUrl}`);

            // Adiciona novos links
            for (const link of links) {
                const cleanLink = link.split('#')[0];
                if (!visited.has(cleanLink) &&
                    !toVisit.includes(cleanLink) &&
                    allPages.size < maxPages) {
                    toVisit.push(cleanLink);
                    allPages.add(cleanLink);
                }
            }

        } catch (err) {
            console.log(`⚠️  Erro ao crawlar ${currentUrl}:`, err.message);
            visited.add(currentUrl);
        }

        await page.waitForTimeout(1000);
    }

    await page.close();

    const pagesArray = Array.from(allPages);
    console.log(`✅ Crawling finalizado: ${pagesArray.length} páginas encontradas`);

    return pagesArray;
}

// 🎯 FUNÇÃO DE SCREENSHOT ROBUSTA (que estava faltando)
async function robustScreenshot(browser, url, filename) {
    const page = await browser.newPage();

    try {
        await page.setDefaultNavigationTimeout(90000);
        await page.setDefaultTimeout(60000);

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 90000
        });

        await page.waitForTimeout(8000);

        await page.screenshot({
            path: filename,
            fullPage: true,
            timeout: 30000
        });

        await page.close();
        return true;

    } catch (err) {
        console.log(`⚠️  Erro parcial em ${url}: ${err.message}`);

        try {
            await page.screenshot({
                path: filename,
                fullPage: true
            });
            console.log(`✅ Screenshot de emergência salvo para ${url}`);
        } catch (screenshotErr) {
            console.log(`❌ Falha total em ${url}: ${screenshotErr.message}`);
        }

        await page.close();
        return false;
    }
}

// 🎯 FUNÇÃO DE COMPARAÇÃO DE IMAGENS
function compareImages(img1Path, img2Path) {
    const img1 = PNG.sync.read(fs.readFileSync(img1Path));
    const img2 = PNG.sync.read(fs.readFileSync(img2Path));

    const minWidth = Math.min(img1.width, img2.width);
    const minHeight = Math.min(img1.height, img2.height);

    const resizedImg1 = new PNG({
        width: minWidth,
        height: minHeight
    });
    const resizedImg2 = new PNG({
        width: minWidth,
        height: minHeight
    });

    for (let y = 0; y < minHeight; y++) {
        for (let x = 0; x < minWidth; x++) {
            const idx1 = (img1.width * y + x) << 2;
            const idx2 = (img2.width * y + x) << 2;
            const idxOut = (minWidth * y + x) << 2;

            if (x < img1.width && y < img1.height) {
                resizedImg1.data[idxOut] = img1.data[idx1];
                resizedImg1.data[idxOut + 1] = img1.data[idx1 + 1];
                resizedImg1.data[idxOut + 2] = img1.data[idx1 + 2];
                resizedImg1.data[idxOut + 3] = img1.data[idx1 + 3];
            }

            if (x < img2.width && y < img2.height) {
                resizedImg2.data[idxOut] = img2.data[idx2];
                resizedImg2.data[idxOut + 1] = img2.data[idx2 + 1];
                resizedImg2.data[idxOut + 2] = img2.data[idx2 + 2];
                resizedImg2.data[idxOut + 3] = img2.data[idx2 + 3];
            }
        }
    }

    const diff = new PNG({
        width: minWidth,
        height: minHeight
    });
    const numDiffPixels = pixelmatch(
        resizedImg1.data,
        resizedImg2.data,
        diff.data,
        minWidth,
        minHeight, {
            threshold: 0.1
        }
    );

    return {
        diff,
        numDiffPixels,
        width: minWidth,
        height: minHeight
    };
}

// 🎯 HEALTH CHECK para Railway
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    service: 'comparador-sites',
    timestamp: new Date().toISOString()
  });
});

// 🎯 Rota raiz também
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Comparador de Sites Online',
    timestamp: new Date().toISOString()
  });
});

// 🎯 ROTA DE COMPARAÇÃO SIMPLES
app.post("/compare", async (req, res) => {
    // Limpa imagens antigas
    fs.readdirSync("public").forEach(file => {
        if (file.endsWith(".png")) {
            fs.unlinkSync(`public/${file}`);
        }
    });


    const {
        url1,
        url2,
        width = 1280,
        height = 800
    } = req.body;

    try {
        const browser = await chromium.launch();
        const page = await browser.newPage({
            viewport: {
                width,
                height
            }
        });

        async function screenshot(url, filename) {
            await page.goto(url, {
                waitUntil: "networkidle",
                timeout: 90000
            });
            await page.screenshot({
                path: filename,
                fullPage: true
            });
        }

        await screenshot(url1, "public/site1.png");
        await screenshot(url2, "public/site2.png");

        const {
            diff,
            numDiffPixels
        } = compareImages("public/site1.png", "public/site2.png");

        fs.writeFileSync("public/diff.png", PNG.sync.write(diff));
        await browser.close();

        res.json({
            success: true,
            diffUrl: "/diff.png",
            numDiffPixels
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// 🎯 ROTA DE CRAWLING COMPLETO (CORRIGIDA)
app.post("/compare-full-site", async (req, res) => {
    // Limpa imagens antigas
    fs.readdirSync("public").forEach(file => {
        if (file.endsWith(".png")) {
            fs.unlinkSync(`public/${file}`);
        }
    });
    const {
        baseUrl1,
        baseUrl2,
        maxPages = 30
    } = req.body;

    try {
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        console.log("🕷️ Iniciando crawling do Site 1...");
        const pages1 = await crawlSite(browser, baseUrl1, maxPages);
        console.log(`✅ Site 1: ${pages1.length} páginas encontradas`);

        console.log("🕷️ Iniciando crawling do Site 2...");
        const pages2 = await crawlSite(browser, baseUrl2, maxPages);
        console.log(`✅ Site 2: ${pages2.length} páginas encontradas`);

        const allUniqueUrls = [...new Set([...pages1, ...pages2])].slice(0, maxPages);
        console.log(`🔍 Vamos comparar ${allUniqueUrls.length} páginas...`);

        const results = [];

        for (const [index, path] of allUniqueUrls.entries()) {
            const url1 = path.replace(new URL(path).origin, new URL(baseUrl1).origin);
            const url2 = path.replace(new URL(path).origin, new URL(baseUrl2).origin);

            try {
                console.log(`📸 ${index + 1}/${allUniqueUrls.length}: ${new URL(path).pathname || '/'}`);

                const success1 = await robustScreenshot(browser, url1, `public/site1-batch-${index}.png`);
                const success2 = await robustScreenshot(browser, url2, `public/site2-batch-${index}.png`);

                if (success1 && success2) {
                    try {
                        const {
                            diff,
                            numDiffPixels
                        } = compareImages(
                            `public/site1-batch-${index}.png`,
                            `public/site2-batch-${index}.png`
                        );

                        const diffFilename = `diff-batch-${index}.png`;
                        fs.writeFileSync(`public/${diffFilename}`, PNG.sync.write(diff));

                        results.push({
                            name: `Página ${index + 1}: ${new URL(path).pathname || '/'}`,
                            diffUrl: `/${diffFilename}`,
                            numDiffPixels,
                            url1,
                            url2,
                            path: new URL(path).pathname,
                            status: 'success'
                        });

                    } catch (compareErr) {
                        console.log(`❌ Erro na comparação de ${url1}: ${compareErr.message}`);
                        results.push({
                            name: `Página ${index + 1}: ${new URL(path).pathname || '/'}`,
                            error: `Erro na comparação: ${compareErr.message}`,
                            url1,
                            url2,
                            status: 'comparison_error'
                        });
                    }
                } else {
                    console.log(`⚠️  Falha ao capturar screenshots para ${url1}`);
                    results.push({
                        name: `Página ${index + 1}: ${new URL(path).pathname || '/'}`,
                        error: "Falha ao capturar screenshots de uma ou ambas as páginas",
                        url1,
                        url2,
                        status: 'screenshot_error'
                    });
                }

            } catch (err) {
                console.log(`❌ Erro crítico na página ${url1}:`, err.message);
                results.push({
                    name: `Página ${index + 1}: ${new URL(path).pathname || '/'}`,
                    error: err.message,
                    url1,
                    url2,
                    status: 'critical_error'
                });
            }

            console.log(`📊 Progresso: ${index + 1}/${allUniqueUrls.length} (${Math.round(((index + 1) / allUniqueUrls.length) * 100)}%)`);
        }

        await browser.close();

        res.json({
            success: true,
            totalPagesFound: allUniqueUrls.length,
            totalCompared: results.length,
            results
        });

    } catch (err) {
        console.error("❌ Erro geral no crawling:", err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

app.listen(3000, () => console.log("🚀 Servidor rodando em http://localhost:3000"));