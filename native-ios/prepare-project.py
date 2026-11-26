import json
import plistlib
import shutil
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree

ROOT = Path(__file__).resolve().parent
NAME = "SpacetimeGlobe"
PROJECT = ROOT / f"{NAME}.xcodeproj"
BUNDLE = "io.github.lllliam.spacetimeglobe.native"
VERSION = "0.1.1"
OBJECTS = {}


def add(kind, **fields):
    identifier = f"{len(OBJECTS) + 1:024X}"
    OBJECTS[identifier] = {"isa": kind, **fields}
    return identifier


def serialize(value, depth=0):
    indent = "\t" * depth
    child = indent + "\t"
    if isinstance(value, dict):
        return "{\n" + "".join(
            f"{child}{json.dumps(key)} = {serialize(item, depth + 1)};\n"
            for key, item in value.items()
        ) + indent + "}"
    if isinstance(value, list):
        return "(\n" + "".join(
            f"{child}{serialize(item, depth + 1)},\n" for item in value
        ) + indent + ")"
    return json.dumps(value, ensure_ascii=False)


def file_ref(path, file_type):
    return add("PBXFileReference", path=path, lastKnownFileType=file_type, sourceTree="<group>")


def phase(kind, references):
    entries = [add("PBXBuildFile", fileRef=reference) for reference in references]
    return add(kind, buildActionMask=2147483647, files=entries, runOnlyForDeploymentPostprocessing=0)


def configurations(settings):
    entries = [
        add("XCBuildConfiguration", name="Debug",
            buildSettings={**settings, "SWIFT_OPTIMIZATION_LEVEL": "-Onone"}),
        add("XCBuildConfiguration", name="Release",
            buildSettings={**settings, "SWIFT_OPTIMIZATION_LEVEL": "-O"}),
    ]
    return add("XCConfigurationList", buildConfigurations=entries,
               defaultConfigurationIsVisible=0, defaultConfigurationName="Release")


def prepare():
    if not (ROOT / "OfflineData" / "Library.json").is_file():
        raise SystemExit("Run node native-ios/prepare-data.mjs before generating the iOS project.")
    PROJECT.mkdir(exist_ok=True)
    icons = ROOT / "AppIcon.xcassets" / "AppIcon.appiconset"
    icons.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT.parent / "assets" / "icon-master.png", icons / "AppIcon.png")
    info = {"author": "xcode", "version": 1}
    (icons.parent / "Contents.json").write_text(json.dumps({"info": info}), encoding="utf-8")
    (icons / "Contents.json").write_text(json.dumps({
        "images": [{"filename": "AppIcon.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
        "info": info,
    }), encoding="utf-8")
    plist = {
        "CFBundleDevelopmentRegion": "zh-Hans",
        "CFBundleDisplayName": "时空地球",
        "CFBundleExecutable": "$(EXECUTABLE_NAME)",
        "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": "$(PRODUCT_NAME)",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "$(MARKETING_VERSION)",
        "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        "LSRequiresIPhoneOS": True,
        "UILaunchScreen": {},
        "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
    }
    with (PROJECT / "Info.plist").open("wb") as stream:
        plistlib.dump(plist, stream)

    sources = [file_ref(file.name, "sourcecode.swift") for file in sorted((ROOT / "Sources").glob("*.swift"))]
    source_group = add("PBXGroup", children=sources, path="Sources", sourceTree="<group>")
    resources = [file_ref("OfflineData", "folder"), file_ref("AppIcon.xcassets", "folder.assetcatalog")]
    product = add("PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0,
                  path=f"{NAME}.app", sourceTree="BUILT_PRODUCTS_DIR")
    products = add("PBXGroup", children=[product], name="Products", sourceTree="<group>")
    main_group = add("PBXGroup", children=[source_group, *resources, products], sourceTree="<group>")
    target_config = configurations({
        "PRODUCT_NAME": NAME,
        "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE,
        "MARKETING_VERSION": VERSION,
        "CURRENT_PROJECT_VERSION": "2",
        "GENERATE_INFOPLIST_FILE": "NO",
        "INFOPLIST_FILE": f"{PROJECT.name}/Info.plist",
        "TARGETED_DEVICE_FAMILY": "1",
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
        "ENABLE_PREVIEWS": "NO",
    })
    target = add("PBXNativeTarget", name=NAME, productName=NAME,
                 productType="com.apple.product-type.application", productReference=product,
                 buildConfigurationList=target_config,
                 buildPhases=[phase("PBXSourcesBuildPhase", sources), phase("PBXFrameworksBuildPhase", []),
                              phase("PBXResourcesBuildPhase", resources)],
                 buildRules=[], dependencies=[])
    project_config = configurations({
        "SDKROOT": "iphoneos",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "IPHONEOS_DEPLOYMENT_TARGET": "16.0",
        "SWIFT_VERSION": "5.0",
        "ALWAYS_SEARCH_USER_PATHS": "NO",
    })
    project = add("PBXProject", attributes={"LastUpgradeCheck": "2600"}, buildConfigurationList=project_config,
                  compatibilityVersion="Xcode 14.0", developmentRegion="zh-Hans", hasScannedForEncodings=0,
                  knownRegions=["zh-Hans", "en", "Base"], mainGroup=main_group, productRefGroup=products,
                  projectDirPath="", projectRoot="", targets=[target])
    pbx = {"archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": OBJECTS, "rootObject": project}
    (PROJECT / "project.pbxproj").write_text("// !$*UTF8*$!\n" + serialize(pbx) + "\n", encoding="utf-8")

    schemes = PROJECT / "xcshareddata" / "xcschemes"
    schemes.mkdir(parents=True, exist_ok=True)
    scheme = Element("Scheme", LastUpgradeVersion="2600", version="1.7")
    build = SubElement(scheme, "BuildAction", parallelizeBuildables="YES", buildImplicitDependencies="YES")
    entries = SubElement(build, "BuildActionEntries")
    entry = SubElement(entries, "BuildActionEntry", buildForTesting="YES", buildForRunning="YES",
                       buildForProfiling="YES", buildForArchiving="YES", buildForAnalyzing="YES")
    SubElement(entry, "BuildableReference", BuildableIdentifier="primary", BlueprintIdentifier=target,
               BuildableName=f"{NAME}.app", BlueprintName=NAME, ReferencedContainer=f"container:{PROJECT.name}")
    SubElement(scheme, "ArchiveAction", buildConfiguration="Release", revealArchiveInOrganizer="YES")
    ElementTree(scheme).write(schemes / f"{NAME}.xcscheme", encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    prepare()
