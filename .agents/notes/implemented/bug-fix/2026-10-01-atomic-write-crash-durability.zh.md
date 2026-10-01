# Agent Note: Atomic-write 崩溃持久性

Status: implemented

[English](2026-10-01-atomic-write-crash-durability.md) | 中文

## 问题

`writeFileAtomic` 的替换是原子的，但不持久：临时兄弟文件只做了写入与 rename，没有任何 `fsync`，因此断电落在这个窗口内时，目标文件可能被回退或变成零长度。消费方都是启动关键路径——凭据存储在其文件无效时会中止整个启动，因此一份撕裂的 `.credentials.yaml` 会把一次断电变成应用无法启动，直到操作者手工干预。这个缺口在三处都有记录（源码中的 `settings-atomic-durability` TODO、一条已知限制、凭据存储里一条继承的限制），每一处都把持久性留作"调用方的策略"——但没有任何调用方能实现它：写入路径属于本包。

## 决策

`writeFileAtomic` 现在以 `wx` 加调用方声明的权限位打开临时兄弟文件，写入，对文件句柄执行 fsync，关闭句柄，rename 到目标上，并在 POSIX 上对父目录执行 fsync——与 `dsh-storage-json` 的 `writeAtomic` 对单元文件已经在用的发布协议一致。Windows 上跳过目录 fsync，因为该平台拒绝以 `O_RDONLY` 打开目录，因此 rename 的持久性在那里依赖 NTFS 卷日志；文件数据本身在每个平台都被 fsync。携带权限位的独占打开本就保留了仅属主权限，所以 TODO 的另一半无需额外工作。三处文档声明在同一次改动中改写，TODO 关闭。

## 曾考虑的替代方案

- **继续把持久性留作调用方的策略** — 拒绝：调用方无法对自己不拥有的 rename 执行 fsync；唯一的杠杆在本包内部，而"启动即死"正是持久性缺口会产出的失败形态。
- **与 `dsh-storage-json` 抽取共享助手** — 暂时拒绝：两者差异实质（这里有携带权限位的 `wx` 打开、Windows 瞬时 rename 重试、锁集成；那里是固定的 `0o600`），为了约 10 行重复代码把零依赖工具耦合进 storage 组不值得。
- **Windows 上用 `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)`** — 拒绝：Node 的 `rename` 不暴露该标志，为这一项保证引入原生插件与卷日志的实际可靠性不成比例。

## 后果

一次完成的 `writeFileAtomic` 替换在 POSIX 上可挺过断电；凭据与配置文件的编辑不再在崩溃窗口内冒"零长度、阻塞启动"的风险。每次写入现在多付一次文件 fsync，POSIX 上再加一次目录 fsync——各一次设备往返，在机械盘上可测，但只有本就值得原子性的写入才支付。Windows 的 rename 持久性与之前一样依赖卷日志。2026-10-01 健壮性审计的建议（"约 10 行，storage-json 已有模板"）就此关闭，本记录是其属主。
