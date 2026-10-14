import DOMPurify from 'dompurify';

// Static previews only: no scripts, network access, forms or navigation.
export function preview(source: string): string {
    const html = DOMPurify.sanitize(source, {
        ADD_TAGS: ['style'],
        FORCE_BODY: true,
        FORBID_TAGS: [
            'script',
            'iframe',
            'object',
            'embed',
            'form',
            'input',
            'button',
            'textarea',
            'select',
            'meta',
            'base',
            'link',
            'audio',
            'video',
            'source',
        ],
        FORBID_ATTR: ['href', 'xlink:href', 'action', 'formaction', 'target', 'download', 'srcset'],
    });

    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:16px;font:16px/1.5 system-ui;color:#171717;background:#fff;overflow-wrap:anywhere}img,svg{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;
}
