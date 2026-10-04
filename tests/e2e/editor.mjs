export async function tools(page) {
    const show = page.getByRole('button', { name: 'Show formatting', exact: true });
    if (await show.isVisible()) await show.click();
}

export async function options(page) {
    await tools(page);
    await page.getByRole('button', { name: 'More editor options', exact: true }).click();
}

export async function format(page, name) {
    await tools(page);
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count()) await button.click();
    else {
        await options(page);
        await page.getByRole('menuitem', { name, exact: true }).click();
    }
}
