# MusicFree 酷我音乐音源插件

基于酷我音乐公开网页接口实现的 [MusicFree](https://github.com/maotoumao/MusicFree) 音源插件，仅供学习与技术交流，请勿用于任何商业用途。

## 功能

| 功能 | 说明 |
|---|---|
| 搜索 | 单曲 / 专辑 / 歌手 |
| 播放 | 128kbps mp3 |
| 歌词 | 逐行 LRC |
| 专辑详情 | 专辑曲目列表（搜索 + ALBUMID 过滤实现） |
| 歌手作品 | 歌手单曲 / 专辑列表（搜索 + ARTISTID 过滤实现） |

歌单、排行榜功能未实现：酷我的相关旧接口（`plserv` / `nplserver`）已下线，`www.kuwo.cn/api/www` 新接口需要登录态校验，插件协议允许缺省，MusicFree 会自动隐藏对应入口。

## 安装

1. 打开 MusicFree（[PC 版](https://github.com/maotoumao/MusicFreeDesktop) 或 [Android 版](https://github.com/maotoumao/MusicFree)）
2. 进入 **设置 → 插件**
3. 选择 **导入** → 本地文件，选择本目录下的 `kuwo.js`（也可以把文件放到任意网盘/OSS，通过 URL 导入）

## 已知限制（重要）

- **VIP / 强版权歌曲只能播放约 10 秒试听**。这是酷我服务端行为：匿名接口（`antiserver convert_url`）对非限制歌曲返回完整音频，对强版权歌曲（如周杰伦、热门新歌）只下发试听片段，插件无法绕过。搜索结果里这类歌曲播放时会很快结束，属于正常现象。
- **音质固定 128kbps**。匿名接口不接受音质参数（`br=320kmp3`、FLAC 均被拒绝或返回相同文件）。
- 专辑/歌手列表通过"搜索后按 ID 过滤"实现，极端情况下（重名多、搜索结果被相关性排序打散）可能漏掉个别条目。
- 接口为酷我官方页面的公开接口，随时可能变更或加校验。本插件基于 2026-09 实测可用的接口编写，若失效请参考 `kuwo.js` 中的接口常量排查。

## 实现说明

代码为单个 CommonJS 文件，无构建步骤；仅依赖 MusicFree 沙箱内置的 `axios` 与 `he` 两个包。注意点：

- 搜索接口 `search.kuwo.cn/r.s` 返回的是单引号、裸键名的类 JSON 文本，`parseRs()` 用状态机把它转成严格 JSON 后解析（不用 `new Function`/`eval`，保证安卓 Hermes 引擎兼容）；
- 语法保持在 ES8 以下、无 `?.` / `??`，兼容安卓版；
- `getMediaSource` 结果声明 `cacheControl: 'no-cache'`，因为播放地址带时效 token，过期很快。
