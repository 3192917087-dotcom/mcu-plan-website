/* ========================================
   prompt-loader.js
   负责从 GitHub 加载最新的 prompt 模板
   ======================================== */

const PromptLoader = (() => {
    // 默认 prompt URL 模板（占位符）
    const DEFAULT_URL_TEMPLATE =
        'https://raw.githubusercontent.com/{user}/mcu-plan-website/main/prompts/mcu-plan-prompt.md';

    // localStorage key
    const LS_KEYS = {
        githubUser: 'mcu-plan:github-user',
        promptCache: 'mcu-plan:prompt-cache',
        promptTimestamp: 'mcu-plan:prompt-timestamp',
        promptSource: 'mcu-plan:prompt-source',
    };

    /**
     * 拼出 prompt URL
     */
    function buildUrl(githubUser) {
        if (!githubUser) return null;
        return DEFAULT_URL_TEMPLATE.replace('{user}', encodeURIComponent(githubUser));
    }

    /**
     * 从 localStorage 读缓存
     */
    function readCache() {
        try {
            const text = localStorage.getItem(LS_KEYS.promptCache);
            const timestamp = localStorage.getItem(LS_KEYS.promptTimestamp);
            const source = localStorage.getItem(LS_KEYS.promptSource);
            if (text && timestamp) {
                return { text, timestamp: parseInt(timestamp, 10), source };
            }
        } catch (e) {
            console.warn('prompt cache read failed:', e);
        }
        return null;
    }

    /**
     * 写缓存
     */
    function writeCache(text, source) {
        try {
            localStorage.setItem(LS_KEYS.promptCache, text);
            localStorage.setItem(LS_KEYS.promptTimestamp, Date.now().toString());
            localStorage.setItem(LS_KEYS.promptSource, source);
        } catch (e) {
            console.warn('prompt cache write failed:', e);
        }
    }

    /**
     * 从 URL 加载 prompt（远程）
     */
    async function fetchFromRemote(githubUser) {
        const url = buildUrl(githubUser);
        if (!url) {
            throw new Error('未设置 GitHub 用户名');
        }

        // 加时间戳绕过缓存
        const bustUrl = `${url}?t=${Date.now()}`;

        const response = await fetch(bustUrl, {
            cache: 'no-store',
            headers: { 'Accept': 'text/plain' },
        });

        if (!response.ok) {
            throw new Error(
                `拉取 Prompt 失败 (HTTP ${response.status})：` +
                (response.status === 404
                    ? '仓库/文件不存在，请检查 GitHub 用户名或仓库是否设为 Public'
                    : '网络错误')
            );
        }

        const text = await response.text();
        if (!text || text.length < 100) {
            throw new Error('拉取到的 Prompt 内容异常短，请检查文件');
        }

        writeCache(text, url);
        return { text, source: url, timestamp: Date.now() };
    }

    /**
     * 加载 prompt 模板
     * @param {boolean} forceRefresh - 是否强制从远程拉取
     * @returns {Promise<{text: string, source: string, timestamp: number}>}
     */
    async function load(forceRefresh = false) {
        const githubUser = localStorage.getItem(LS_KEYS.githubUser) || '';

        if (!forceRefresh) {
            const cached = readCache();
            if (cached) return cached;
        }

        if (!githubUser) {
            throw new Error('请先在设置里填 GitHub 用户名');
        }

        return await fetchFromRemote(githubUser);
    }

    /**
     * 从 URL 中提取版本号（从日期行）
     */
    function extractVersion(text) {
        const match = text.match(/版本[：:]\s*v?(\d+\.\d+)/);
        return match ? match[1] : '?';
    }

    /**
     * 格式化时间戳
     */
    function formatTimestamp(ts) {
        if (!ts) return '从未';
        const d = new Date(ts);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    }

    return {
        load,
        buildUrl,
        extractVersion,
        formatTimestamp,
        LS_KEYS,
    };
})();
