async function setIcInputValue(page, selector, value) {
    await page.waitForFunction(
        name => Boolean(customElements.get(name)),
        'ic-input',
    );
    await page.locator(selector).evaluate((element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    }, value);
}

async function submitLogin(page, baseUrl, username, password) {
    await setIcInputValue(page, '#username', username);
    await setIcInputValue(page, '#password', password);
    await Promise.all([
        page.waitForURL(`${baseUrl}/`, { timeout: 10000 }),
        page.click('#login-submit'),
    ]);
}

module.exports = { setIcInputValue, submitLogin };
