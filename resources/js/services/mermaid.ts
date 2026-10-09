import library from 'mermaid/dist/mermaid.min.js?raw';

// Run the renderer in an opaque-origin frame, not in the editor's DOM. Only
// these two nonce-bearing scripts run; diagram content cannot access Docs or
// fetch images, fonts, scripts or other network resources. Load the library
// through the parent bundle so Cloudflare auth never depends on frame cookies.
export function mermaid(source: string, dark: boolean, id: string): string {
    const nonce = id.replaceAll('-', '');
    const data = JSON.stringify(source).replace(/</g, '\\u003c');
    const script = library.replace(/<\/script/gi, '<\\/script');
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${dark ? '#171717' : '#fff'};color:${dark ? '#e5e5e5' : '#171717'};font:14px system-ui}#stage{height:100%;width:100%;touch-action:none;cursor:grab}#stage:active{cursor:grabbing}#stage>svg{display:block;width:100%!important;height:100%!important;max-width:none!important}</style>
</head><body data-theme="${dark ? 'dark' : 'light'}"><div id="stage"></div>
<script nonce="${nonce}">${script}</script>
<script nonce="${nonce}">
(async () => {
    const stage = document.getElementById('stage');
    try {
        const source = ${data};
        if (!source.trim()) throw new Error('Add Mermaid code to preview a diagram.');
        if (source.length > 50000) throw new Error('Diagram is too large (50,000 characters maximum).');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
            theme: '${dark ? 'dark' : 'default'}', fontFamily: 'system-ui', maxTextSize: 50000, maxEdges: 500,
            secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering', 'maxTextSize', 'maxEdges', 'theme', 'themeCSS', 'fontFamily', 'htmlLabels'],
            htmlLabels: false });
        const result = await mermaid.render('diagram', source);
        const template = document.createElement('template');
        template.innerHTML = result.svg;
        template.content.querySelectorAll('script,iframe,object,embed,foreignObject').forEach(el => el.remove());
        template.content.querySelectorAll('*').forEach(el => {
            for (const attr of [...el.attributes]) {
                if (/^on/i.test(attr.name) || (['href', 'xlink:href', 'src'].includes(attr.name) && !attr.value.startsWith('#'))) el.removeAttribute(attr.name);
            }
        });
        stage.replaceChildren(template.content);
        const svg = stage.querySelector('svg');
        if (!svg) throw new Error('Unable to render diagram.');
        const original = svg.getAttribute('viewBox').trim().split(/[ ,]+/).map(Number);
        let view = [...original];
        const apply = () => svg.setAttribute('viewBox', view.join(' '));
        function zoom(factor) {
            const scale = Math.max(0.5, Math.min(12, original[2] / view[2] * factor));
            const width = original[2] / scale, height = original[3] / scale;
            view = [view[0] + (view[2] - width) / 2, view[1] + (view[3] - height) / 2, width, height];
            apply();
        }
        addEventListener('message', event => {
            if (event.source !== parent || event.data?.type !== 'mermaid') return;
            if (event.data.action === 'in') zoom(1.25);
            if (event.data.action === 'out') zoom(0.8);
            if (event.data.action === 'reset') { view = [...original]; apply(); }
        });
        let drag;
        const point = event => new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
        stage.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = point(event); stage.setPointerCapture(event.pointerId); });
        stage.addEventListener('pointermove', event => { if (!drag) return; const next = point(event); view[0] += drag.x - next.x; view[1] += drag.y - next.y; apply(); });
        stage.addEventListener('lostpointercapture', () => { drag = undefined; });
        parent.postMessage({ type: 'mermaid', id: '${id}', status: 'ready' }, '*');
    } catch (error) {
        stage.replaceChildren();
        parent.postMessage({ type: 'mermaid', id: '${id}', status: 'error', error: String(error.message || 'Unable to render diagram.').slice(0, 1000) }, '*');
    }
})();
</script></body></html>`;
}
