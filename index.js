import express from "express";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import sharp from "sharp";
import fs from "fs";

const app = express();
app.use(express.json());
app.use(express.static("public"));

// 🎯 FUNÇÃO DE CRAWLING
// 🎯 FUNÇÃO DE CRAWLING CORRIGIDA COM DEBUG
async function crawlSite(browser, baseUrl, maxPages = 50) {
    const visited = new Set();
    const toVisit = [baseUrl];
    const allPages = new Set([baseUrl]);

    const page = await browser.newPage();
    await page.setDefaultTimeout(60000);
    await page.setDefaultNavigationTimeout(60000);

    console.log(`🔍 Iniciando crawling em: ${baseUrl}`);

    let pageCount = 0;

    while (toVisit.length > 0 && pageCount < maxPages) {
        const currentUrl = toVisit.shift();

        if (visited.has(currentUrl)) {
            console.log(`⏭️  Já visitado: ${currentUrl}`);
            continue;
        }

        console.log(`🌐 [${pageCount + 1}/${maxPages}] Crawling: ${currentUrl}`);
        
        try {
            await page.goto(currentUrl, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });

            await page.waitForTimeout(3000);
            visited.add(currentUrl);
            pageCount++;

            // 🔥 DEBUG: Verifica se a página carregou
            const pageTitle = await page.title();
            console.log(`   📄 Título: ${pageTitle}`);
            console.log(`   🔗 URL atual: ${page.url()}`);

            // 🔥 ESTRATÉGIA MAIS AGRESSIVA: Tenta múltiplos métodos
            let links = [];

            // Método 1: Links simples
            try {
                links = await page.$$eval('a[href]', (anchors, baseUrl) => {
                    return anchors
                        .map(a => a.href)
                        .filter(href => {
                            try {
                                if (!href) return false;
                                // Converte URL relativa para absoluta
                                const absoluteUrl = new URL(href, window.location.href).href;
                                const baseDomain = new URL(baseUrl).hostname;
                                const linkDomain = new URL(absoluteUrl).hostname;
                                
                                return linkDomain === baseDomain;
                            } catch {
                                return false;
                            }
                        })
                        .map(href => new URL(href, window.location.href).href)
                        .filter(href => 
                            !href.includes('#') && 
                            !href.includes('mailto:') && 
                            !href.includes('tel:') &&
                            !href.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|mp3|mp4|jpg|jpeg|png|gif)$/i)
                        );
                }, baseUrl);
            } catch (err) {
                console.log(`   ⚠️  Método 1 falhou: ${err.message}`);
            }

            // Se não encontrou links, tenta método alternativo
            if (links.length === 0) {
                console.log(`   🔄 Tentando método alternativo...`);
                try {
                    links = await page.evaluate((baseUrl) => {
                        const allLinks = [];
                        const anchors = document.querySelectorAll('a[href]');
                        
                        for (const anchor of anchors) {
                            try {
                                const href = anchor.href;
                                if (!href) continue;
                                
                                const absoluteUrl = new URL(href, window.location.href).href;
                                const baseDomain = new URL(baseUrl).hostname;
                                const linkDomain = new URL(absoluteUrl).hostname;
                                
                                if (linkDomain === baseDomain && 
                                    !href.includes('#') && 
                                    !href.includes('mailto:') && 
                                    !href.includes('tel:') &&
                                    !href.match(/\.(pdf|doc|docx|xls|xlsx|zip|rar|mp3|mp4|jpg|jpeg|png|gif)$/i)) {
                                    allLinks.push(absoluteUrl);
                                }
                            } catch (e) {
                                // Ignora links inválidos
                            }
                        }
                        return [...new Set(allLinks)]; // Remove duplicatas
                    }, baseUrl);
                } catch (err) {
                    console.log(`   ⚠️  Método 2 falhou: ${err.message}`);
                }
            }

            console.log(`   📎 Encontrados ${links.length} links em ${currentUrl}`);

            // 🔥 DEBUG: Mostra os primeiros links encontrados
            if (links.length > 0) {
                console.log(`   🔗 Primeiros links:`, links.slice(0, 3));
            }

            // Adiciona novos links
            let newLinksCount = 0;
            for (const link of links) {
                const cleanLink = link.split('#')[0].split('?')[0]; // Remove anchors e query params
                if (!visited.has(cleanLink) && 
                    !toVisit.includes(cleanLink) && 
                    pageCount + newLinksCount < maxPages) {
                    toVisit.push(cleanLink);
                    allPages.add(cleanLink);
                    newLinksCount++;
                }
            }

            console.log(`   ➕ ${newLinksCount} novos links adicionados`);

        } catch (err) {
            console.log(`❌ Erro ao crawlar ${currentUrl}:`, err.message);
            visited.add(currentUrl);
        }

        await page.waitForTimeout(2000);
    }

    await page.close();
    
    const pagesArray = Array.from(allPages);
    console.log(`✅ Crawling finalizado: ${pagesArray.length} páginas encontradas`);
    console.log(`📋 Páginas encontradas:`, pagesArray);
    
    return pagesArray;
}

// 🎯 FUNÇÃO DE SCREENSHOT ROBUSTA
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

// 🎯 FUNÇÃO DE COMPARAÇÃO COM SHARP + PIXELMATCH (MODERNA E CONFIÁVEL)
async function compareImages(img1Path, img2Path) {
    try {
        // Lê e processa as imagens com Sharp
        const image1 = await sharp(img1Path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const image2 = await sharp(img2Path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

        const { width: width1, height: height1 } = image1.info;
        const { width: width2, height: height2 } = image2.info;

        // Usa o menor tamanho entre as duas imagens
        const width = Math.min(width1, width2);
        const height = Math.min(height1, height2);

        // Redimensiona ambas para o mesmo tamanho
        const [buffer1, buffer2] = await Promise.all([
            sharp(img1Path)
                .resize(width, height)
                .ensureAlpha()
                .raw()
                .toBuffer(),
            sharp(img2Path)
                .resize(width, height)
                .ensureAlpha()
                .raw()
                .toBuffer()
        ]);

        // Cria imagem de diff
        const diff = new PNG({ width, height });
        
        // 🔥 CONFIGURAÇÕES INTELIGENTES
        const numDiffPixels = pixelmatch(
            buffer1, 
            buffer2, 
            diff.data, 
            width, 
            height, 
            {
                threshold: 0.05,           // Threshold mais baixo para mais sensibilidade
                includeAA: false,          // Ignora anti-aliasing
                alpha: 0.3,                // Considera transparência
                aaColor: [255, 255, 0, 255], // Amarelo para anti-aliasing
                diffColor: [255, 0, 0, 255]  // Vermelho para diferenças reais
            }
        );

        const timestamp = Date.now();
        const diffFilename = `diff-${timestamp}.png`;
        const diffPath = `public/${diffFilename}`;

        // Salva a imagem diff
        await sharp(diff.data, {
            raw: { width, height, channels: 4 }
        }).png().toFile(diffPath);

        const totalPixels = width * height;
        const diffPercentage = (numDiffPixels / totalPixels) * 100;
        
        // 🎯 CLASSIFICAÇÃO INTELIGENTE DAS DIFERENÇAS
        const getDifferenceLevel = () => {
            if (diffPercentage < 0.1) return 'insignificante';
            if (diffPercentage < 1) return 'pequena';
            if (diffPercentage < 5) return 'moderada';
            return 'significante';
        };

        return {
            diff: PNG.sync.read(fs.readFileSync(diffPath)),
            numDiffPixels,
            diffPercentage: Math.round(diffPercentage * 100) / 100, // 2 casas decimais
            isSignificant: diffPercentage > 0.1, // > 0.1% é significativo
            differenceLevel: getDifferenceLevel(),
            diffUrl: `/${diffFilename}`,
            stats: {
                totalPixels,
                diffPixels: numDiffPixels,
                similarity: Math.round(((totalPixels - numDiffPixels) / totalPixels) * 100 * 100) / 100,
                width,
                height
            }
        };

    } catch (error) {
        throw new Error(`Erro na comparação de imagens: ${error.message}`);
    }
}

// 🎯 HEALTH CHECK para Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy',
        service: 'comparador-sites',
        timestamp: new Date().toISOString()
    });
});

// 🎯 Rota raiz
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
        if (file.startsWith("site1.png") || file.startsWith("site2.png") || file.startsWith("diff-")) {
            try {
                fs.unlinkSync(`public/${file}`);
            } catch (e) {
                console.log(`⚠️  Não foi possível deletar ${file}: ${e.message}`);
            }
        }
    });

    const { url1, url2, width = 1280, height = 800 } = req.body;

    try {
        const browser = await chromium.launch();
        const page = await browser.newPage({ viewport: { width, height } });

        async function screenshot(url, filename) {
            await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
            await page.screenshot({ path: filename, fullPage: true });
        }

        await screenshot(url1, "public/site1.png");
        await screenshot(url2, "public/site2.png");

        const result = await compareImages("public/site1.png", "public/site2.png");
        
        await browser.close();

        res.json({
            success: true,
            diffUrl: result.diffUrl,
            numDiffPixels: result.numDiffPixels,
            diffPercentage: result.diffPercentage,
            isSignificant: result.isSignificant,
            differenceLevel: result.differenceLevel,
            similarity: result.stats.similarity,
            stats: result.stats
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// 🎯 ROTA DE CRAWLING COMPLETO
app.post("/compare-full-site", async (req, res) => {
    // Limpa imagens antigas
    fs.readdirSync("public").forEach(file => {
        if (file.startsWith("site1-batch-") || file.startsWith("site2-batch-") || file.startsWith("diff-batch-") || file.startsWith("diff-")) {
            try {
                fs.unlinkSync(`public/${file}`);
            } catch (e) {
                console.log(`⚠️  Não foi possível deletar ${file}: ${e.message}`);
            }
        }
    });

    const { baseUrl1, baseUrl2, maxPages = 30 } = req.body;

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
                        const result = await compareImages(
                            `public/site1-batch-${index}.png`,
                            `public/site2-batch-${index}.png`
                        );

                        results.push({
                            name: `Página ${index + 1}: ${new URL(path).pathname || '/'}`,
                            diffUrl: result.diffUrl,
                            numDiffPixels: result.numDiffPixels,
                            diffPercentage: result.diffPercentage,
                            isSignificant: result.isSignificant,
                            differenceLevel: result.differenceLevel,
                            similarity: result.stats.similarity,
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

// 🎯 ROTA DE DEBUG CRAWLING
app.post("/debug-crawl", async (req, res) => {
    const { url, maxPages = 5 } = req.body;

    try {
        const browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        console.log("🐛 DEBUG: Iniciando crawling...");
        const pages = await crawlSite(browser, url, maxPages);
        
        await browser.close();

        res.json({
            success: true,
            url,
            totalPages: pages.length,
            pages: pages,
            debug: `Encontradas ${pages.length} páginas em ${url}`
        });

    } catch (err) {
        console.error("❌ Erro no debug:", err);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    }
});

app.listen(3000, () => console.log(`🚀 Servidor rodando na porta ${3000}`));