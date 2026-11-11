# gnome-weather-local

基于 GNOME Weather **43.0** 的独立天气应用，将地点搜索和天气数据改为 Open-Meteo，并提供 GNOME Shell 扩展，让日历天气卡片使用相同来源与地点设置。支持 GNOME **43、48、51** 的日历卡片接入。

## 安装或更新

在 GNOME 桌面中，以普通用户运行：

```sh
curl -fsSL https://raw.githubusercontent.com/XARKUR/gnome-weather-local/main/install.sh | sh
```

也可以先下载脚本查看，再执行：

```sh
curl -fsSLo install.sh https://raw.githubusercontent.com/XARKUR/gnome-weather-local/main/install.sh
sh install.sh
```

已下载源码时，进入项目目录执行 `./install.sh`。首次安装和更新使用同一命令：准备应用和扩展、备份旧版本、保留地点与温度单位，并保存扩展启用设置。遇到安装错误会恢复旧版；不覆盖不属于本项目的文件或符号链接。

完成后打开应用列表中的 **gnome-weather-local**。日历扩展需要**注销并重新登录**才能加载新版本。应用可直接重开。脚本不会安装系统软件，也不会自动卸载官方天气应用；不需要 API Key、Node.js 或资源编译工具。

## 运行依赖

需要 Python 3.9+、GJS、GTK4、libadwaita 1.2+、GWeather 4、Soup 3、GeoClue 的 GI 类型库及 `glib-compile-schemas`。完整 GNOME 桌面通常已有运行库；缺少时可安装：

```sh
# Debian
sudo apt install python3 gjs gir1.2-gtk-4.0 gir1.2-adw-1 \
  gir1.2-gweather-4.0 gir1.2-soup-3.0 gir1.2-geoclue-2.0 libglib2.0-bin

# Arch Linux
sudo pacman -S --needed python gjs gtk4 libadwaita libgweather-4 libsoup3 geoclue glib2
```

启动器使用简体中文界面，需要系统生成 `zh_CN.UTF-8` locale。不要使用 root 或 sudo 运行项目安装脚本。

## 功能

- 中文地点搜索，使用接口返回的省、州和国家信息区分同名地点。
- 支持手动坐标：`名称;纬度,经度`，例如 `北京;39.9042,116.4074`。
- 当前温度、体感、昼夜天气图标、湿度、风速，以及每小时和每天预报。
- 摄氏/华氏切换同时更新应用和日历卡片，不需重新取天气。
- 应用和日历共享地点列表；日历使用列表第一项。地点副标题使用搜索接口的 `admin1` 字段，没有按城市硬编码省份。
- 15 分钟缓存；联网失败时最多使用 24 小时内缓存。缺失数据标记为不可用，不转换成零值。
- 手动选择地点，不启用自动定位。

Open-Meteo 公共接口有使用范围与频率限制，请阅读其[服务条款](https://open-meteo.com/en/terms)。请求会向对应服务发送搜索词或所选地点坐标；数据来源在应用内注明。

## 安装位置与卸载

应用位于 `~/.local/share/system-weather/`，日历扩展位于 `~/.local/share/gnome-shell/extensions/weather@system.local/`。应用 ID 继续使用 `org.gnome.Weather.Local`，扩展 UUID 保留 `weather@system.local`，以兼容已有设置。地点和温度单位不会因更新被重置。

更新备份位于 `~/.local/share/gnome-extension-project-backups/gnome-weather-local/`。卸载前先关闭天气应用，并执行：

```sh
gnome-extensions disable weather@system.local
gnome-extensions uninstall weather@system.local
rm -rf ~/.local/share/system-weather
rm -f ~/.local/share/applications/org.gnome.Weather.Local.desktop
rm -f ~/.local/share/icons/hicolor/scalable/apps/org.gnome.Weather.Local.svg
```

卸载不自动删除已保存的设置，也不会修改官方天气应用。

## 开发与验证

```sh
git clone https://github.com/XARKUR/gnome-weather-local.git
cd gnome-weather-local
python3 project.py build
python3 project.py check
python3 project.py check --live  # 额外访问天气及地点接口
```

源码已包含，无需初始化子模块。修改集中在 `overrides/` 和 `project.py`，生成源码位于 `build/source/`。仓库附带可校验的跨架构界面资源；修改资源后需用 `glib-compile-resources` 重建。

完整开发检查另需 Node.js。测试使用临时配置、缓存和内存设置后端，覆盖预报数据、单位切换、真实 GTK 组件、原生天气卡片接口及安装失败恢复。接口模拟检查不能代替实际桌面视觉验收，验证范围见 `VALIDATION.json`。构建目录、安装备份、用户设置与缓存不纳入仓库。

## 许可证与来源

这是修改版，不是 GNOME 官方发布版本。保留 GNOME Weather 原始源码、版权声明、图标和翻译署名；完整修改应用按 GPL-3.0-or-later 发布，各文件沿用原有许可证。详见 `LICENSE`、`LICENSE-GPL-2.md`、`LICENSE-GPL-3`、`NOTICE` 和 `upstream.lock.json`。

天气：[Open-Meteo](https://open-meteo.com/)；地点：[GeoNames](https://www.geonames.org/)；上游：[GNOME Weather](https://gitlab.gnome.org/GNOME/gnome-weather)。
