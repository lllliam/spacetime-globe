import json
import plistlib
import shutil
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree

ROOT = Path(__file__).resolve().parent
NAME = "SpacetimeGlobe"
PROJECT = ROOT / f"{NAME}.xcodeproj"
BUNDLE = "io.github.lllliam.spacetimeglobe.native"
VERSION = "0.3.3"
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
        "CADisableMinimumFrameDurationOnPhone": True,
        "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
    }
    with (PROJECT / "Info.plist").open("wb") as stream:
        plistlib.dump(plist, stream)

    sources = [file_ref(file.name, "sourcecode.swift") for file in sorted((ROOT / "Sources").glob("*.swift"))]
    source_group = add("PBXGroup", children=sources, path="Sources", sourceTree="<group>")
    tests = [file_ref(file.name, "sourcecode.swift") for file in sorted((ROOT / "Tests").glob("*.swift"))]
    test_group = add("PBXGroup", children=tests, path="Tests", sourceTree="<group>")
    resources = [file_ref("OfflineData", "folder"), file_ref("AppIcon.xcassets", "folder.assetcatalog")]
    product = add("PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0,
                  path=f"{NAME}.app", sourceTree="BUILT_PRODUCTS_DIR")
    test_product = add("PBXFileReference", explicitFileType="wrapper.cfbundle", includeInIndex=0,
                       path=f"{NAME}UITests.xctest", sourceTree="BUILT_PRODUCTS_DIR")
    products = add("PBXGroup", children=[product, test_product], name="Products", sourceTree="<group>")
    main_group = add("PBXGroup", children=[source_group, test_group, *resources, products], sourceTree="<group>")
    target_config = configurations({
        "PRODUCT_NAME": NAME,
        "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE,
        "MARKETING_VERSION": VERSION,
        "CURRENT_PROJECT_VERSION": "7",
        "GENERATE_INFOPLIST_FILE": "NO",
        "INFOPLIST_FILE": f"{PROJECT.name}/Info.plist",
        "TARGETED_DEVICE_FAMILY": "1",
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
        "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
        "ENABLE_PREVIEWS": "NO",
        "ENABLE_DEBUG_DYLIB": "NO",
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
    test_config = configurations({
        "PRODUCT_NAME": NAME + "UITests",
        "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE + ".uitests",
        "GENERATE_INFOPLIST_FILE": "YES",
        "TARGETED_DEVICE_FAMILY": "1",
        "TEST_TARGET_NAME": NAME,
        "CODE_SIGN_IDENTITY": "-",
    })
    test_target = add("PBXNativeTarget", name=NAME + "UITests", productName=NAME + "UITests",
                      productType="com.apple.product-type.bundle.ui-testing", productReference=test_product,
                      buildConfigurationList=test_config,
                      buildPhases=[phase("PBXSourcesBuildPhase", tests), phase("PBXFrameworksBuildPhase", [])],
                      buildRules=[], dependencies=[])
    project = add("PBXProject", attributes={"LastUpgradeCheck": "2600",
                 "TargetAttributes": {test_target: {"TestTargetID": target}}},
                  buildConfigurationList=project_config,
                  compatibilityVersion="Xcode 14.0", developmentRegion="zh-Hans", hasScannedForEncodings=0,
                  knownRegions=["zh-Hans", "en", "Base"], mainGroup=main_group, productRefGroup=products,
                  projectDirPath="", projectRoot="", targets=[target, test_target])
    proxy = add("PBXContainerItemProxy", containerPortal=project, proxyType=1,
                remoteGlobalIDString=target, remoteInfo=NAME)
    dependency = add("PBXTargetDependency", target=target, targetProxy=proxy)
    OBJECTS[test_target]["dependencies"].append(dependency)
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
    test_build = SubElement(entries, "BuildActionEntry", buildForTesting="YES", buildForRunning="NO",
                            buildForProfiling="NO", buildForArchiving="NO", buildForAnalyzing="NO")
    test_reference = {
        "BuildableIdentifier": "primary", "BlueprintIdentifier": test_target,
        "BuildableName": f"{NAME}UITests.xctest", "BlueprintName": NAME + "UITests",
        "ReferencedContainer": f"container:{PROJECT.name}",
    }
    SubElement(test_build, "BuildableReference", **test_reference)
    test_action = SubElement(scheme, "TestAction", buildConfiguration="Debug",
                             selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn",
                             shouldUseLaunchSchemeArgsEnv="YES")
    testables = SubElement(test_action, "Testables")
    testable = SubElement(testables, "TestableReference", skipped="NO", parallelizable="NO")
    SubElement(testable, "BuildableReference", **test_reference)
    SubElement(scheme, "ArchiveAction", buildConfiguration="Release", revealArchiveInOrganizer="YES")
    ElementTree(scheme).write(schemes / f"{NAME}.xcscheme", encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    prepare()
