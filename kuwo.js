/**
 * MusicFree 音源插件 —— 酷我音乐
 *
 * 基于酷我音乐公开网页接口实现，仅供学习与技术交流，请勿用于商业用途。
 * 数据来源均为酷我官方页面公开接口：
 *  - 搜索:        search.kuwo.cn/r.s
 *  - 播放地址:     antiserver.kuwo.cn/anti.s (convert_url)
 *  - 歌词:        m.kuwo.cn/newh5/singles/songinfoandlrc
 *
 * 已知限制：
 *  - 播放地址统一为 128kbps mp3（酷我匿名接口仅提供此规格）；
 *  - 部分强版权/会员歌曲仅能获取到约 10 秒试听片段，为酷我服务端行为，插件无法绕过。
 */

const axios = require('axios');
const he = require('he');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

const RS_API = 'http://search.kuwo.cn/r.s';
const PLAY_API = 'https://antiserver.kuwo.cn/anti.s';
const LYRIC_API = 'http://m.kuwo.cn/newh5/singles/songinfoandlrc';
const ALBUM_COVER_PREFIX = 'https://img4.kuwo.cn/star/albumcover/';
const ARTIST_PIC_PREFIX = 'https://img1.kuwo.cn/star/starheads/';

/** r.s 接口返回的是单引号、裸键名的类 JSON 文本，先转成严格 JSON 再解析 */
function parseRs(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    var out = '';
    var inStr = false;
    var i;
    var ch;
    var safe = '"\\/bfnrtu';
    for (i = 0; i < text.length; i++) {
        ch = text.charAt(i);
        if (!inStr) {
            if (ch === "'") {
                inStr = true;
                out += '"';
            } else if (/[A-Za-z0-9_]/.test(ch)) {
                // 裸键名：读取连续标识符，仅当后面紧跟冒号时按键名处理
                var j = i;
                while (j < text.length && /[A-Za-z0-9_]/.test(text.charAt(j))) {
                    j++;
                }
                var k = j;
                while (k < text.length && /\s/.test(text.charAt(k))) {
                    k++;
                }
                if (text.charAt(k) === ':') {
                    out += '"' + text.slice(i, j) + '"' + text.slice(j, k) + ':';
                    i = k;
                } else {
                    out += ch;
                }
            } else {
                out += ch;
            }
        } else {
            if (ch === '\\') {
                var next = text.charAt(i + 1);
                if (safe.indexOf(next) >= 0) {
                    out += ch + next;
                } else {
                    out += '\\\\' + next;
                }
                i++;
            } else if (ch === "'") {
                inStr = false;
                out += '"';
            } else if (ch === '\n') {
                out += '\\n';
            } else if (ch === '\r') {
                out += '';
            } else {
                out += ch;
            }
        }
    }
    try {
        return JSON.parse(out);
    } catch (e) {
        return null;
    }
}

function decodeHtml(str) {
    if (!str) {
        return '';
    }
    try {
        // 酷我接口会把 & 转义成 \u0026（JSON 解析后仍残留反斜杠），先还原再做实体解码
        return he.decode(String(str).replace(/\\u0026/g, '&'));
    } catch (e) {
        return String(str);
    }
}

/** 短图路径转绝对地址 */
function picUrl(path, prefix) {
    if (!path) {
        return undefined;
    }
    if (/^https?:/.test(path)) {
        return path;
    }
    return prefix + path;
}

function parseIntSafe(v, dft) {
    var n = parseInt(v, 10);
    return isNaN(n) ? (dft || 0) : n;
}

function mapMusicItem(x) {
    var rid = String(x.MUSICRID || x.musicrid || '').replace('MUSIC_', '');
    if (!rid) {
        return null;
    }
    return {
        id: rid,
        title: decodeHtml(x.SONGNAME || x.NAME),
        artist: decodeHtml(x.ARTIST),
        album: decodeHtml(x.ALBUM),
        duration: parseIntSafe(x.DURATION, 0),
        artwork: picUrl(x.web_albumpic_short, ALBUM_COVER_PREFIX) || picUrl(x.hts_MVPIC, '') || undefined,
    };
}

function mapAlbumItem(x) {
    var id = String(x.albumid || x.id || '');
    if (!id) {
        return null;
    }
    return {
        id: id,
        title: decodeHtml(x.album || x.name || x.ALBUM),
        artist: decodeHtml(x.artist || x.aartist),
        artwork: picUrl(x.hts_img || x.img, ''),
        description: x.info ? decodeHtml(x.info).replace(/\\\\/g, '').replace(/\s*;\s*/g, '\n') : undefined,
        playCount: parseIntSafe(x.PLAYCNT, 0),
    };
}

function mapArtistItem(x) {
    var id = String(x.ARTISTID || x.artistid || '');
    if (!id) {
        return null;
    }
    return {
        id: id,
        name: decodeHtml(x.ARTIST || x.artist),
        avatar: picUrl(x.PICPATH, ARTIST_PIC_PREFIX) || picUrl(x.hts_img || x.img, ''),
        worksNum: parseIntSafe(x.SONGNUM || x.SONGNUM, 0) || parseIntSafe(x.albumnum, 0) || undefined,
        description: x.desc ? decodeHtml(x.desc) : undefined,
    };
}

/**
 * 搜索。ft: music / album / artist
 * 返回 { total: number, list: array }
 */
async function rsSearch(keyword, ft, page, rn) {
    var res = await axios.get(RS_API, {
        params: {
            all: keyword,
            ft: ft,
            itemset: 'web_2013',
            client: 'kt',
            pn: (page - 1) * rn,
            rn: rn,
            rformat: 'json',
            encoding: 'utf8',
            vipver: 'MUSIC_8.0.3.2_BCS2',
        },
        headers: {
            'User-Agent': UA,
            Referer: 'http://www.kuwo.cn/',
        },
        timeout: 10000,
    });
    var data = typeof res.data === 'string' ? parseRs(res.data) : res.data;
    if (!data) {
        return { total: 0, list: [] };
    }
    return {
        total: parseIntSafe(data.TOTAL, 0),
        list: data.abslist || data.albumlist || [],
    };
}

function pageResult(list, total, page, rn, mapper) {
    var items = [];
    var i;
    var m;
    for (i = 0; i < list.length; i++) {
        m = mapper(list[i]);
        if (m) {
            items.push(m);
        }
    }
    return {
        isEnd: items.length === 0 || (page - 1) * rn + rn >= total,
        data: items,
    };
}

async function searchMusic(query, page) {
    var rn = 30;
    var r = await rsSearch(query, 'music', page, rn);
    return pageResult(r.list, r.total, page, rn, mapMusicItem);
}

async function searchAlbum(query, page) {
    var rn = 30;
    var r = await rsSearch(query, 'album', page, rn);
    return pageResult(r.list, r.total, page, rn, mapAlbumItem);
}

async function searchArtist(query, page) {
    var rn = 30;
    var r = await rsSearch(query, 'artist', page, rn);
    return pageResult(r.list, r.total, page, rn, mapArtistItem);
}

/** 秒数转 [mm:ss.xx] */
function fmtTime(sec) {
    sec = Math.max(0, sec);
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec - Math.floor(sec)) * 100);
    var p2 = function (n) {
        return (n < 10 ? '0' : '') + n;
    };
    return p2(m) + ':' + p2(s) + '.' + (ms < 10 ? '0' + ms : ms);
}

module.exports = {
    platform: '酷我音乐',
    version: '1.0.0',
    author: 'ZCode',
    supportedSearchType: ['music', 'album', 'artist'],
    cacheControl: 'no-cache',

    search: async function (query, page, type) {
        page = page || 1;
        if (type === 'album') {
            return searchAlbum(query, page);
        }
        if (type === 'artist') {
            return searchArtist(query, page);
        }
        return searchMusic(query, page);
    },

    /** 播放地址。酷我匿名接口统一返回 128kbps mp3；强版权歌曲为约 10 秒试听。 */
    getMediaSource: async function (musicItem, quality) {
        var res = await axios.get(PLAY_API, {
            params: {
                type: 'convert_url',
                rid: musicItem.id,
                format: 'mp3',
                response: 'url',
            },
            headers: {
                'User-Agent': UA,
            },
            timeout: 10000,
            responseType: 'text',
            transformResponse: function (d) {
                return d;
            },
        });
        var url = String(res.data || '').trim();
        if (url.indexOf('http') === 0) {
            return {
                url: url,
                headers: {
                    'User-Agent': UA,
                },
            };
        }
        return null;
    },

    getLyric: async function (musicItem) {
        var res = await axios.get(LYRIC_API, {
            params: {
                musicId: musicItem.id,
            },
            headers: {
                'User-Agent': MOBILE_UA,
            },
            timeout: 10000,
        });
        var data = res.data && res.data.data;
        var lrclist = data && data.lrclist;
        if (!lrclist || !lrclist.length) {
            return {
                rawLrc: '',
            };
        }
        var lines = [];
        var i;
        for (i = 0; i < lrclist.length; i++) {
            var t = parseFloat(lrclist[i].time);
            if (isNaN(t)) {
                t = 0;
            }
            lines.push('[' + fmtTime(t) + ']' + (lrclist[i].lineLyric || ''));
        }
        return {
            rawLrc: lines.join('\n'),
        };
    },

    /**
     * 专辑详情：酷我旧版专辑接口已下线，
     * 通过「按专辑名搜索 → 按 ALBUMID 过滤」得到该专辑的曲目。
     */
    getAlbumInfo: async function (albumItem, page) {
        page = page || 1;
        var rn = 100;
        var r = await rsSearch(albumItem.title, 'music', page, rn);
        var picked = [];
        var i;
        for (i = 0; i < r.list.length; i++) {
            if (String(r.list[i].ALBUMID) === String(albumItem.id)) {
                var m = mapMusicItem(r.list[i]);
                if (m) {
                    picked.push(m);
                }
            }
        }
        return {
            isEnd: r.list.length === 0 || page * rn >= r.total,
            musicList: picked,
        };
    },

    /** 歌手作品：按歌手名搜索后按 ARTISTID / artistid 过滤。type: 'music' | 'album' */
    getArtistWorks: async function (artistItem, page, type) {
        page = page || 1;
        var rn = 30;
        if (type === 'album') {
            var ra = await rsSearch(artistItem.name, 'album', page, rn);
            var albums = [];
            var i2;
            for (i2 = 0; i2 < ra.list.length; i2++) {
                if (String(ra.list[i2].artistid) === String(artistItem.id)) {
                    var a = mapAlbumItem(ra.list[i2]);
                    if (a) {
                        albums.push(a);
                    }
                }
            }
            return {
                isEnd: albums.length === 0 || (page - 1) * rn + rn >= ra.total,
                data: albums,
            };
        }
        var r = await rsSearch(artistItem.name, 'music', page, rn);
        var musics = [];
        var i3;
        for (i3 = 0; i3 < r.list.length; i3++) {
            if (String(r.list[i3].ARTISTID) === String(artistItem.id)) {
                var m2 = mapMusicItem(r.list[i3]);
                if (m2) {
                    musics.push(m2);
                }
            }
        }
        return {
            isEnd: musics.length === 0 || (page - 1) * rn + rn >= r.total,
            data: musics,
        };
    },
};
