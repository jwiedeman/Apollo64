const puppeteer = require('puppeteer');

async function goToNextPage(page){
    // Click the "Next page" navigation button.
    await page.click('button[aria-label=" Next page "]');
    await page.waitForNetworkIdle();
}

async function hasNextPage(page){
    const element = await page.$('button[aria-label=" Next page "]')
    if(!element){
        throw new Error('Next page element is missing')
    }

    // Determine if the "Next page" button is disabled.
    const disabled = await page.evaluate((el) => el.getAttribute('disabled'), element)
    if(disabled){
        console.log('The next page button is disabled')
    }
    return !disabled
}


async function autoScroll(page) {
    await page.evaluate(async () =>{
        await new Promise((resolve,reject)=>{
            var totalHeight =0
            var distance = 300
            var timer = setInterval(()=>{
                const element = document.querySelectorAll('.section-scrollbox')[1];
                var scrollHeight = element.scrollHeight;
                element.scrollBy(0,distance)
                totalHeight += distance
                if(totalHeight >= scrollHeight){
                    clearInterval(timer);
                    resolve();
                }
            },100)
        })
    })
}


async function parsePlaces(page){
    let places = [];

    const elements = await page.$$('.gm2-subtitle-alt-1 span');
    if(elements && elements.length){
        for(const el of elements){
            const name = await el.evaluate(span => span.textContent)

            places.push({name})
        }
    }
    return places
}

(async () =>{
    const browser = await puppeteer.launch({headless:false})
    const page = await browser.newPage();


    await page.goto('https://www.google.com/maps/search/food/@45.765173,-122.8903587,14z')
    
    let places = []
    do{
        await autoScroll(page)
        places = places.concat(await parsePlaces(page))
        console.log("Parsed "+ places.length + 'places')
        await goToNextPage(page)
        
    } while (await hasNextPage(page))
    
    console.log('asd',places)
})

console.log('test')