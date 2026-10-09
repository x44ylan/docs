import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';

type Loader = () => Promise<{ default: LanguageFn }>;

// The remaining grammars of lowlight's `common` set load on first use, so the
// editor supports the same languages without shipping them all up front.
// Keep in sync with lazyGrammar in vite.config.js.
export const lazyLanguages: Record<string, Loader> = {
    arduino: () => import('highlight.js/lib/languages/arduino'),
    c: () => import('highlight.js/lib/languages/c'),
    cpp: () => import('highlight.js/lib/languages/cpp'),
    csharp: () => import('highlight.js/lib/languages/csharp'),
    go: () => import('highlight.js/lib/languages/go'),
    graphql: () => import('highlight.js/lib/languages/graphql'),
    ini: () => import('highlight.js/lib/languages/ini'),
    java: () => import('highlight.js/lib/languages/java'),
    kotlin: () => import('highlight.js/lib/languages/kotlin'),
    less: () => import('highlight.js/lib/languages/less'),
    lua: () => import('highlight.js/lib/languages/lua'),
    makefile: () => import('highlight.js/lib/languages/makefile'),
    objectivec: () => import('highlight.js/lib/languages/objectivec'),
    perl: () => import('highlight.js/lib/languages/perl'),
    'php-template': () => import('highlight.js/lib/languages/php-template'),
    'python-repl': () => import('highlight.js/lib/languages/python-repl'),
    r: () => import('highlight.js/lib/languages/r'),
    ruby: () => import('highlight.js/lib/languages/ruby'),
    rust: () => import('highlight.js/lib/languages/rust'),
    scss: () => import('highlight.js/lib/languages/scss'),
    swift: () => import('highlight.js/lib/languages/swift'),
    vbnet: () => import('highlight.js/lib/languages/vbnet'),
    wasm: () => import('highlight.js/lib/languages/wasm'),
};

// Aliases declared by the lazy grammars (highlight.js registers them on load).
const lazyAliases: Record<string, string> = {
    ino: 'arduino',
    h: 'c',
    cc: 'cpp', 'c++': 'cpp', 'h++': 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', cxx: 'cpp',
    cs: 'csharp', 'c#': 'csharp',
    golang: 'go',
    gql: 'graphql',
    toml: 'ini',
    jsp: 'java',
    kt: 'kotlin', kts: 'kotlin',
    pluto: 'lua',
    mk: 'makefile', mak: 'makefile', make: 'makefile',
    mm: 'objectivec', objc: 'objectivec', 'obj-c': 'objectivec', 'obj-c++': 'objectivec', 'objective-c++': 'objectivec',
    pl: 'perl', pm: 'perl',
    pycon: 'python-repl',
    rb: 'ruby', gemspec: 'ruby', podspec: 'ruby', thor: 'ruby', irb: 'ruby',
    rs: 'rust',
    vb: 'vbnet',
};

// Resolves a code block language to the lazy grammar it needs, if any.
export function lazyLanguageFor(language: string): string | undefined {
    const name = language.toLowerCase();

    return name in lazyLanguages ? name : lazyAliases[name];
}

// Returns a lowlight instance with the common grammars preloaded and the rest
// fetched when a code block first asks for them; onLoad then re-highlights.
export function createLazyLowlight(onLoad: (grammar: string) => void) {
    const lowlight = createLowlight({
        bash, css, diff, javascript, json, markdown, php, plaintext, python, shell, sql, typescript, xml, yaml,
    });
    // Archify source is JSON; avoid expensive language auto-detection on
    // larger diagrams, including while the rich editor is hidden.
    lowlight.registerAlias({ json: 'archify' });
    lowlight.registerAlias({ plaintext: 'mermaid' });

    const loading = new Set<string>();
    const registered = lowlight.registered;

    // The code block plugin checks registered() before highlighting.
    lowlight.registered = (language: string): boolean => {
        const isRegistered = registered(language);
        const grammar = isRegistered ? undefined : lazyLanguageFor(language);

        if (grammar && !loading.has(grammar)) {
            loading.add(grammar);
            lazyLanguages[grammar]()
                .then(module => {
                    lowlight.register({ [grammar]: module.default });
                    onLoad(grammar);
                })
                .catch(() => loading.delete(grammar));
        }

        return isRegistered;
    };

    return lowlight;
}
