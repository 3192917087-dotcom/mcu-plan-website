/* ========================================
   prompt-loader.js (v2 - 简化版)
   直接接收 URL，不再从 localStorage 读 GitHub 用户名
   ======================================== */

const PromptLoader = (() => {
    const LS = {
        cache: 'mcu-plan:prompt-cache',
        timestamp: 'mcu-plan:prompt-timestamp',
    };

    function readCache() {
        try {
            const text = localStorage.getItem(LS.cache);
            const ts = localStorage.getItem(LS.timestamp);
            if (text && ts) {
                return { text, timestamp: parseInt(ts, 10) };
            }
        } catch (e) {
            console.warn('prompt cache read failed:', e);
        }
        return null;
    }

    function writeCache(text) {
        try {
            localStorage.setItem(LS.cache, text);
            localStorage.setItem(LS.timestamp, Date.now().toString());
        } catch (e) {
            console.warn('prompt cache write failed:', e);
        }
    }

    /**
     * 从指定 URL 加载 prompt
     * @param {string} url - prompt 文件的完整 URL
     * @param {boolean} forceRefresh - 是否强制从远程拉取（绕过缓存）
     */
    async function loadFromUrl(url, forceRefresh = false) {
        if (!url) throw new Error('未提供 Prompt URL');

        if (!forceRefresh) {
            const cached = readCache();
            if (cached) return cached;
        }

        const bustUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        const response = await fetch(bustUrl, {
            cache: 'no-store',
            headers: { 'Accept': 'text/plain' },
        });

        if (!response.ok) {
            throw new Error(
                `拉取 Prompt 失败 (HTTP ${response.status})：` +
                (response.status === 404
                    ? '文件不存在，请检查仓库路径'
                    : '网络错误')
            );
        }

        const text = await response.text();
        if (!text || text.length < 100) {
            throw new Error('拉取到的 Prompt 内容异常短，请检查文件');
        }

        writeCache(text);
        return { text, timestamp: Date.now() };
    }

    /**
     * 从文本中提取版本号
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
        loadFromUrl,
        extractVersion,
        formatTimestamp,
    };
})();
