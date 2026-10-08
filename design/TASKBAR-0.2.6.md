# 0.2.6 固定到任务栏图标

症状：运行时为新纸页图标，用户从运行按钮固定后又显示旧「字」图标。新建固定项仍指向正确的 EXE，但 IconLocation 为 `,0`，没有显式 RelaunchIconResource；只改一次旧快捷方式不能覆盖下一次固定。

修复：运行窗口同时设置 RelaunchCommand（带引号的完整 EXE 路径）、RelaunchIconResource（独立 `assets/Ziban-paper.ico,0`）、RelaunchDisplayNameResource（字伴）和窗口级 AppUserModel.ID（仍为 Rizum.Ziban）。先写 relaunch 属性，再写窗口 ID。保留现有进程 AppID，不重置任务栏分组身份。退出时清空窗口属性；系统已销毁 HWND 时清理可安全略过。

资源生成器、EXE 编译图标和窗口图标同步使用 Ziban-paper.ico。原位更新同步修正现有固定项的 IconLocation，不新增、取消固定或重启 Explorer。

验证：TypeScript 类型检查与 Windows 发布构建通过。真实 message-only HWND 探针分别以 Bun 开发运行、编译 EXE 运行，写入四个属性后独立 GetValue 读回匹配（包括中文、空格路径和引号），清理后四项均为空，未创建可见窗口或任务栏固定项。ZIP CRC 校验通过。没有替用户操作真实桌面“取消固定/重新固定”；这一最终交互仍待用户验证。未改变启动项、个人设置、退出行为或隐藏行为。

参考：
- https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchiconresource
- https://learn.microsoft.com/en-us/windows/win32/properties/props-system-appusermodel-relaunchdisplaynameresource
- https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shgetpropertystoreforwindow
