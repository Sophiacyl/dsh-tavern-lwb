# 测试环境

需要 Node.js 22 或更新版本、npm 和 git。运行包没有外部依赖；以下依赖和公开参考源码都只用于开发测试，不进入发布 ZIP。

核心与宿主 mock 测试零外部依赖：

```sh
node --test tests/core.test.mjs tests/host.test.mjs
```

从新 clone 准备完整合成验收环境（在项目根目录执行）：

```sh
npm --prefix tests/runtime ci --ignore-scripts --cache "$PWD/tests/.npm-cache"
npm run test:prepare
npm run pack:zip
node --experimental-loader ./tests/loader.mjs --test tests/*.test.mjs
```

只有显式执行 `npm run test:prepare`（等价于 `node scripts/prepare-test-references.mjs`）才会下载参考源码。测试本身和导入准备脚本都不会下载。脚本从公开仓库 `https://github.com/flizzywine/dsh-tavern.git` checkout 以下固定提交：

- `tests/.references/api7`：`a3fe308af0271010cff9eff00eac72ec4e3eaad0`，API 7。
- `tests/.references/api8`：`babcf0a33ee08a4914cc5270d8aec98ff5621088`，API 8。

已存在的目录必须是 HEAD 正确、无修改和无未跟踪文件的 git checkout；不满足时准备脚本报错，绝不覆盖、reset 或清理。可用 `LWB_API7_ROOT` / `LWB_API8_ROOT` 指向已经准备好的 checkout 根目录（包含 `tavern-plugin/`）；相对路径按当前工作目录解释。覆盖目录只校验，从不创建或修改。离线测试可预先准备这两个固定提交和 npm 缓存。

`tests/loader.mjs` 把 `tests/runtime/package.json` 声明的所有测试依赖统一解析到该隔离目录：Cordis 4.1.0、YAML 2.9.1、React/React DOM 19.2.0、jsdom 26.1.0、marked 16.3.0、chevrotain 11.2.0、Playwright 1.58.2；其传递依赖由 lockfile 固定。运行包不依赖此 loader，也不依赖本机 DSH 安装目录。

真实 API 集成测试只导入公开参考源码，提供合成游戏、内存存储和合成模型结果。API 7／8 测试还验证记忆与宏贡献进入 Tavern 正文请求 Frame、核心事实在无关键词命中时保留、相关事实参与检索，以及关闭记忆开关后记忆段落消失。测试不启动网络 Host、不读取真实 profile，不创建模型请求。持久化测试只在 `tests/.tmp` 写合成 JSON，并在结束时清理自己创建的目录。发布测试检查 `0.1.0-beta.25` ZIP，须先运行 `npm run pack:zip`。

可选离线WAL差分探针：将 `LWB_UPSTREAM_ROOT` 指向已准备的公开LittleWhiteBox checkout（HEAD须为707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a且工作树干净），运行 `node tests/upstream-wal-differential.mjs`。不会下载或修改该checkout，只加载State2纯执行器；5组定向案例与64组固定种子多条目序列同时经WAL和显式swipe选择入口对照变量、规则与根归属；swipe用例混入未选非法记录，验证它们不执行，不执行ST宿主入口。另有3组旧stateLogV2归一化案例，对照重复/空根、显式空归属和缺省根推导。该脚本不在运行ZIP内。

可选离线 plot-log 差分：同样设置 `LWB_UPSTREAM_ROOT`，用支持 `registerHooks` 的 Node（已验证 v24.22.1）运行 `node tests/upstream-plot-differential.mjs`。加载固定上游原始解析器和执行入口，只替换宿主接口为纯内存夹具，比较 37 组定向案例（含 15 组别名规范化、6 组同块别名合并、8 组十进制字符串增量）和 128 组固定种子序列的数值及类型锁。无需安装依赖，不执行事件条件、脚本或 State2，不写上游 checkout，也不进入运行 ZIP。

手机布局测试需要 Playwright Chromium；首次安装同样是显式命令：

```sh
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$PWD/tests/.browsers}" \
  node tests/runtime/node_modules/playwright/cli.js install chromium
node tests/mobile-layout.mjs
```

`node tests/mobile-layout.mjs` 默认使用 `tests/.browsers`，也尊重 `PLAYWRIGHT_BROWSERS_PATH`。浏览器由 Playwright 默认机制查找，不固定 revision 或 x86 路径，支持其提供的 Linux ARM64 headless Chromium。测试使用工作区内独立浏览器 HOME，在断网合成侧栏检查 390×844 手机布局的触摸滚动、底部按钮和浮钮间隔，截图输出至 `tests/layout-output`。这里没有实体 Android WebView 或真实 profile 安装测试。

所有临时目录、npm 缓存、参考 checkout、浏览器和截图均应保持为本地忽略文件。测试通过的范围以验证记录为准。
