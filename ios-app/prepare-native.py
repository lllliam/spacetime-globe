import json
import plistlib
import shutil
from pathlib import Path
from xml.etree import ElementTree


project = Path(__file__).resolve().parent
app = project / "ios" / "App" / "App"
config = json.loads((project / "capacitor.config.json").read_text(encoding="utf-8"))

icon_set = app / "Assets.xcassets" / "AppIcon.appiconset"
icon = json.loads((icon_set / "Contents.json").read_text(encoding="utf-8"))["images"][0]
shutil.copyfile(project.parent / "assets" / "icon-master.png", icon_set / icon["filename"])

info_file = app / "Info.plist"
info = plistlib.loads(info_file.read_bytes())
info["CFBundleDisplayName"] = config["appName"]
info["UIUserInterfaceStyle"] = "Dark"
info["UISupportedInterfaceOrientations"] = ["UIInterfaceOrientationPortrait"]
info_file.write_bytes(plistlib.dumps(info, sort_keys=False))

launch_screen = app / "Base.lproj" / "LaunchScreen.storyboard"
storyboard = ElementTree.parse(launch_screen)
root = storyboard.getroot()
view = root.find(".//imageView[@key='view']")
view.tag = "view"
for attribute in ("image", "horizontalHuggingPriority", "verticalHuggingPriority"):
    view.attrib.pop(attribute, None)
view.find("./color[@key='backgroundColor']").attrib = {
    "key": "backgroundColor",
    "red": str(10 / 255),
    "green": str(16 / 255),
    "blue": str(22 / 255),
    "alpha": "1",
    "colorSpace": "custom",
    "customColorSpace": "sRGB",
}
root.remove(root.find("resources"))
storyboard.write(launch_screen, encoding="utf-8", xml_declaration=True)
