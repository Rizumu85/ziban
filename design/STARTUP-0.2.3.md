# 0.2.3：可选的开机自启

设置新增「开机自启」，默认关闭。开启后当前用户登录 Windows 时启动字伴，窗口隐藏、不会抢焦点；双击右 Ctrl 或原有输入法切换唤起后再输入文字。手动打开 EXE 的行为保持不变。如果两种唤起方式均关闭，或助手启动失败，则显示不激活的窗口以保留操作入口。

## 数据与操作

- 自启状态单独读取 Windows 当前用户的 `Software\Microsoft\Windows\CurrentVersion\Run` 下 `Rizum.Ziban` 值，不放进普通偏好文件。
- 只有用户点击开关才更改该值，不创建计划任务、Windows 服务、管理员启动项；不触碰其他应用的自启项。关闭时只移除指向当前安装的命令。
- 写入完整加引号的 `Ziban.exe` 路径与 `--startup` 参数，支持空格及中文，校验路径和命令长度。写后读回成功才更新开关；处理中防止重复点击，失败保留原状态并显示可重试信息。
- 每次打开设置重新读取。此状态表示该安装的 Run 注册，Windows 启动应用管理仍可以阻止或延迟运行。便携目录移动后需在新位置重新开启。
- `--startup` 在窗口创建时即禁止显示和激活；已有实例时直接退出新进程，不把旧窗口拉到前台。

接口依据：[Microsoft Run and RunOnce Registry Keys](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)、[RegGetValueW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-reggetvaluew)、[RegSetValueExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regsetvalueexw)。

## 验证

- 原生注册表适配器在独立临时、非自启注册表项中完成开启、重新读回、关闭和重复关闭；核对中文与空格引号，拒绝相对路径、引号及超长命令。临时项已清理，真实 `Rizum.Ziban` 自启项保持不变。
- 以 `--startup` 运行编译后的隔离检查版：窗口创建成功但不可见、前台窗口不变；内部唤起后可输入，窗口仍在全部显示器之外。
- 设置页连续 3 轮、每轮 7 项原生内部交互检查通过：读取、默认关闭、开启、返回重开、关闭、已有开关、双字体展开后底部控件完整。检查版使用隔离状态，不会写真实自启项。
- 已查看真实设置页截图：自启说明和底部最近输入均未截断，沿用原有开关动效。
- 没有重启或注销用户电脑，没有为用户开启真实自启项。真实登录后的自动启动尚未做桌面验收。
