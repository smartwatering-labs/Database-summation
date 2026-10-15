"""Versioned public plant records. Legacy entries remain engineering suggestions."""

from copy import deepcopy


SCHEMA_VERSION = 3

# Extension publications support qualitative cultivation guidance. They do not
# substantiate this project's daily mL, demand weights or pump thresholds.
QUALITATIVE_SOURCES = {
    "tomato": ("UMN Extension · Growing tomatoes in home gardens",
               "https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-tomatoes",
               "室外家庭园艺；番茄生长期的土壤保湿与透浇"),
    "pepper": ("UMN Extension · Growing peppers",
               "https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-peppers",
               "室外家庭园艺；辣椒生长阶段与水分管理"),
    "lettuce": ("UMN Extension · Growing lettuce, endive and radicchio in home gardens",
                "https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-lettuce-endive-and-radicchio",
                "室外家庭园艺；生菜表层根系和土壤保湿"),
    "basil": ("UMN Extension · Growing basil in home gardens",
              "https://extension.umn.edu/garden-and-home/yard-and-garden/yard-and-garden-problems/growing-basil",
              "室外家庭园艺；罗勒光照、排水及容器与地栽的差异"),
    "mint": ("UMN Extension · Growing herbs in home gardens",
             "https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/growing-herbs",
             "家庭香草种植；薄荷所在香草类的排水与浇水原则"),
    "pothos": ("Penn State Extension · Pothos as a Houseplant",
               "https://extension.psu.edu/pothos-as-a-houseplant",
               "室内绿萝；土壤干燥后浇水，避免积水"),
    "rose": ("Clemson Extension · Growing Roses",
             "https://hgic.clemson.edu/factsheet/growing-roses/",
             "室外月季／蔷薇类栽培；透浇与根区保湿"),
    "succulent": ("UMN Extension · Cacti and succulents",
                  "https://extension.umn.edu/garden-and-home/yard-and-garden/gardening-in-minnesota/cacti-and-succulents",
                  "室内仙人掌和多肉类；排水、光照及浇水间干燥；不同物种差异较大"),
}


def empty_evidence():
    return {"title": "", "reference": "", "referenceDate": "", "conditions": "",
            "cultivar": "", "growthStage": "", "medium": "", "numericBasis": ""}


def empty_review():
    return {"status": "engineering", "reviewedAt": "", "note": ""}


def empty_field_validation():
    return {"status": "untested", "testedAt": "", "conditions": "", "summary": ""}


def empty_suitability():
    return {"context": "outdoor", "temperatureMinC": None, "temperatureMaxC": None,
            "humidityMinPct": None, "humidityMaxPct": None}


def upgrade_plant_document(document):
    """Return a normalized copy and whether the stored document needs migration."""
    version = document.get("schemaVersion", 1)
    if isinstance(version, bool) or not isinstance(version, int) or version < 1 or version > SCHEMA_VERSION:
        raise ValueError("植物库结构版本高于当前程序支持的版本")
    updated = deepcopy(document)
    changed = version != SCHEMA_VERSION
    updated["schemaVersion"] = SCHEMA_VERSION
    for plant in updated.get("items", []):
        for key, factory in (("evidence", empty_evidence), ("review", empty_review),
                             ("fieldValidation", empty_field_validation), ("suitability", empty_suitability)):
            default = factory()
            if not isinstance(plant.get(key), dict):
                plant[key] = default
                changed = True
            else:
                for field, value in default.items():
                    if field not in plant[key]:
                        plant[key][field] = value
                        changed = True
        if (version < 3 and plant.get("id") in QUALITATIVE_SOURCES
                and plant["review"]["status"] == "engineering"
                and not any(plant["evidence"].values())):
            title, reference, conditions = QUALITATIVE_SOURCES[plant["id"]]
            plant["evidence"].update(title=title, reference=reference, conditions=conditions,
                                     numericBasis="现有每日水量、需求权重与阈值为工程参数；该资料未给出对应数值")
            changed = True
    return updated, changed
