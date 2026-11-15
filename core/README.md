# State2 验证版纯内存 API

Based on LittleWhiteBox by biex. 上游固定为
`707e03f2d7f75bb6588b29625b3bd61b6c4a7c5a`。
来源、许可证及修改明细见 `../vendor/README.md`。

```js
import { emptyEngine, applyText, extractStateBlocks, LIMITS } from './index.mjs';
const engine = emptyEngine();
const result = applyText(engine, '<state>生命值: 100</state>', { requireBlocks: true });
```

`emptyEngine()` 每次返回独立的 `{variables:{}, LWB_RULES_V2:{}, roots:[]}`。
`roots` 为已托管根名称字符串数组。`variables` 存储解码后的 JSON 值；
`LWB_RULES_V2` 是完整规则表。不得仅传上轮增量。

`applyText(engine, text, {requireBlocks=false}={})` 同步返回：

```js
{
  engine, // 完整、新建且可 JSON 序列化的快照
  status: 'success' | 'partial' | 'failed' | 'noop',
  errors: [], corrections: [], changes: [],
  operationCount: 0
}
```

不改变输入对象、不访问主机/存储/网络、不运行上游入口。每次执行建立独立
guard 工厂实例，无模块级共享规则。错误采用中文 message 和稳定 code，
不向主机抛异常或向控制台打印输入。无效 engine 返回 failed 与空的安全快照；
对于有效 engine，致命解析/安全/边界错误整批回滚到输入快照。
规则拒绝、未托管 JSON 根或不适用的操作可在其它操作成功时返回 partial。
`operationCount` 是通过解析和边界校验后的请求操作总数，包含运行时被拒操作；
解析/批边界失败时为 0。只写规则也返回 success。

`errors` 包含 `{code,message,index?,path?}`。`corrections` 包含
`{index,path,requested,value,note}`。`changes` 包含
`{index,path,op,oldValue?,newValue?,delta?}`。内部 remove 仍记作 `pop`。
诊断合计限制为 8192 字节，长值替换为省略说明，超额项不返回；因此 diagnostics
不适合充当回放日志或成功计数来源，应使用完整 engine 与 status。

`requireBlocks=true` 只执行正文中闭合的 state 块；无块为 noop，任何未闭合、
嵌套、自闭合或不匹配的 state 标签为整批 failed。标签大小写不敏感。
默认模式若存在块同样仅执行块；没有块则将全部输入当作 State2 文本或 JSON。
`extractStateBlocks(text)` 为可选辅助函数，返回内容字符串数组；格式错误或
超长输入返回空数组。需要区分错误时必须调用 applyText。

JSON 只接受上游公开 `{ops:[...]}` 规范，经 `parseJsonInput` 与
`validateJsonBatch` 校验。操作为 set/inc/push/remove/del，字段必须精确匹配。
JSON 不能凭空注册未托管根；可先用显式初始化的 State2 文本或 schema 注册。

验证版保守限制：

- 文本（包括块外正文）最多 32768 UTF-8 字节；一批最多 128 ops 和 128 rules；
  完整规则表也最多 128 项。
- 引擎、整批解析树及计算后值均受深度 20、节点 4000 限制；层数包含
  引擎或解析批的容器。每个路径最多 24 段，数组下标最多 2000，
  数组最多 2001 项；扩展产生的间隙采用显式 null，不产生稀疏数组。
- 完整引擎 JSON 最多 48 KiB；诊断最多 8 KiB，给 64 KiB 记录预算留余量。
  溢出、累积规则超限、非有限计算结果等均整批回滚。
- 路径及对象键禁止 prototype / __proto__ / constructor / length。
  路径段不能含空白、转义、点/括号等歧义字符；不支持带点的引用键。
- 仅接受普通 JSON 数据；拒绝访问器、隐藏/Symbol 属性、循环或重复引用、
  Date/Map/Set、函数、非有限数字、稀疏数组。
- YAML 保留普通 mapping/list/scalar，拒绝 anchors/aliases、显式 tags、merge、
  复杂 key、日期等复杂对象及 parser warning；解析过程中另设工作量上限，
  避免先展开别名或深结构。
- 无法识别的行、指令、空/损坏 schema、值解析 warning、未闭合显式引号
  均失败，不静默跳过。schema 必须有根路径；数组模板仅接受零或一个元素；
  不接受 null 模板、带点/括号或危险键的字段。
- 增量同样遵守类型锁、字段白名单和枚举结果；禁止把 schema 标量祖先替换为对象、
  禁止写入只读容器的后代。与上游宽松边缘行为相比，这是验证版主动加严的约束。
- 普通文本数值保留上游含义：正负前缀数值为 inc，括号数值为 set；
  `null` 表示 del。根值的上游编码/解码仍可能将数字字符串转为数字；
  删除/空根的 undefined 在 JSON 快照中省略，roots 继续保留托管关系。

`LIMITS` 为冻结对象，字段为 textBytes, operations, rules, depth, nodes,
pathSegments, arrayIndex, engineBytes, diagnosticBytes, diagnosticItems。

验证命令：`node --test tests/core.test.mjs`，测试仅操作内存与合成数据。
