target_body_name = "fati"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material1"
        break

target_body_name = "fagai"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material1"
        break

target_body_name = "fagan"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material3"
        break

target_body_name = "fazuo"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material1"
        break

target_body_name = "youzhaban"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material4"
        break

target_body_name = "zuozhaban"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material4"
        break

target_body_name = "daoxiangjian"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material2"
        break

target_body_name = "qiumianzhou"
target_body = None
for body in ExtAPI.DataModel.GetObjectsByType(DataModelObjectCategory.Body):
    if body.Name == target_body_name:
        body.Material = "material1"
        break

analysis = Model.Analyses[0]
analysis_settings = analysis.AnalysisSettings
step_index_list = [1]
with Transaction():
    analysis_settings.StepEndTime = Quantity(0.04, "sec")
    for step_index in step_index_list:
        analysis_settings.SetAutomaticTimeStepping(step_index, AutomaticTimeStepping.Off)
        analysis_settings.TimeStep = Quantity(0.02, "sec")
		
coordinate_systems_144 = Model.CoordinateSystems
coordinate_system_551 = coordinate_systems_144.AddCoordinateSystem()

p = coordinate_system_551.PropertyByName("OriginAlignment")
p.InternalValue = 0

coordinate_system_551.OriginX = Quantity(0, "m")
coordinate_system_551.OriginY = Quantity(0, "m")
coordinate_system_551.OriginZ = Quantity(0, "m")

coordinate_system_551.AddTransformation(
    TransformationType.Rotation,
    CoordinateSystemAxisType.PositiveXAxis
)
idxX = coordinate_system_551.TransformationCount
coordinate_system_551.SetTransformationValue(idxX, -0)

coordinate_system_551.AddTransformation(
    TransformationType.Rotation,
    CoordinateSystemAxisType.PositiveYAxis
)
idxY = coordinate_system_551.TransformationCount
coordinate_system_551.SetTransformationValue(idxY, -0)

Gravity = None
for child in analysis.Children:
    if child.Name == "Standard Earth Gravity":
        Gravity = child
        break
Gravity.CoordinateSystem = coordinate_system_551

acc = None
for child in analysis.Children:
    if child.Name == "Acceleration":
        acc = child
        break
acc.CoordinateSystem = coordinate_system_551
acc.DefineBy = LoadDefineBy.Components

file_path = r"J:\ST\AW\fa\fa1\Resources\31acc.txt"

time_list = []
x_list = []
y_list = []
z_list = []

with open(file_path, 'r') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        t, x, y, z = map(float, line.split(','))
        time_list.append(t)
        x_list.append(x)
        y_list.append(y)
        z_list.append(z)

t_quant = [Quantity(t, "sec") for t in time_list]
x_quant = [Quantity(v, "m/s^2") for v in x_list]
y_quant = [Quantity(v, "m/s^2") for v in y_list]
z_quant = [Quantity(v, "m/s^2") for v in z_list]

with Transaction():
    acc.XComponent.Inputs[0].DiscreteValues = t_quant
    acc.XComponent.Output.DiscreteValues = x_quant

    acc.YComponent.Inputs[0].DiscreteValues = t_quant
    acc.YComponent.Output.DiscreteValues = y_quant

    acc.ZComponent.Inputs[0].DiscreteValues = t_quant
    acc.ZComponent.Output.DiscreteValues = z_quant

SOURCE_TIME = 0
CLEAR_ROWS = True
DO_IMPORT = True
ACTIVATE = False

def walk(node):
    for c in node.Children:
        yield c
        for x in walk(c):
            yield x


def is_imported_item(o):
    if o.Name.startswith("Imported Load"):
        return False
    try:
        d = dir(o)
    except Exception:
        return False
    return ("GetTableByName" in d) and ("Import" in d)


def find_source_time(obj):
    exact = None
    fuzzy = None
    for p in obj.VisibleProperties:
        try:
            cap = str(p.Caption)
        except Exception:
            continue
        if cap == "Source Time":
            exact = p
            break
        if fuzzy is None and "Source Time" in cap:
            fuzzy = p
    return exact if exact is not None else fuzzy


def do_import(obj):
    if "Import" in dir(obj):
        obj.Import()
    elif "ImportLoad" in dir(obj.Parent):
        obj.Parent.ImportLoad()
    else:
        raise Exception("no import method available")


def process(obj):
    if CLEAR_ROWS:
        obj.GetTableByName(obj.Name).Clear()
    if SOURCE_TIME is not None:
        p = find_source_time(obj)
        if p is not None:
            p.InternalValue = SOURCE_TIME
    if DO_IMPORT:
        do_import(obj)
    if ACTIVATE:
        obj.Activate()


targets = [o for o in walk(Model) if is_imported_item(o)]

for o in targets:
    process(o)

# import os

# FILE_PATH = r"J:\ST\AW\hengyao.txt"
# RESULT_NAME = "Remote Displacement"

# DATA_ORDER = ["XComponent", "YComponent", "ZComponent",
              # "RotationX", "RotationY", "RotationZ"]

# UNITS = {
    # "XComponent": "m",
    # "YComponent": "m",
    # "ZComponent": "m",
    # "RotationX": "deg",
    # "RotationY": "deg",
    # "RotationZ": "deg",
# }

# def read_file(path):
    # times = []
    # cols = []
    # f = open(path, "r")
    # try:
        # for line in f:
            # s = line.strip()
            # if not s:
                # continue
            # parts = [p.strip() for p in s.split(",")]
            # while parts and parts[-1] == "":
                # parts.pop()
            # if len(parts) < 2:
                # continue
            # vals = [float(p) for p in parts]
            # times.append(vals[0])
            # for i, v in enumerate(vals[1:]):
                # if i >= len(cols):
                    # cols.append([])
                # cols[i].append(v)
    # finally:
        # f.close()
    # return times, cols


# def find_or_add(analysis, name):
    # for child in analysis.Children:
        # try:
            # if str(child.Name) == name:
                # return child
        # except Exception:
            # continue
    # return analysis.AddRemoteDisplacement()

# import os

# FILE_PATH = r"J:\ST\AW\hengyao.txt"
# RESULT_NAME = "Remote Displacement"

# DATA_ORDER = ["XComponent", "YComponent", "ZComponent",
              # "RotationX", "RotationY", "RotationZ"]

# UNITS = {
    # "XComponent": "m",
    # "YComponent": "m",
    # "ZComponent": "m",
    # "RotationX": "deg",
    # "RotationY": "deg",
    # "RotationZ": "deg",
# }


# def read_file(path):
    # times = []
    # cols = []
    # f = open(path, "r")
    # try:
        # for line in f:
            # s = line.strip()
            # if not s:
                # continue
            # parts = [p.strip() for p in s.split(",")]
            # while parts and parts[-1] == "":
                # parts.pop()
            # if len(parts) < 2:
                # continue
            # vals = [float(p) for p in parts]
            # times.append(vals[0])
            # for i, v in enumerate(vals[1:]):
                # if i >= len(cols):
                    # cols.append([])
                # cols[i].append(v)
    # finally:
        # f.close()
    # return times, cols


# def find_or_add(analysis, name):
    # for child in analysis.Children:
        # try:
            # if str(child.Name) == name:
                # return child
        # except Exception:
            # continue
    # return analysis.AddRemoteDisplacement()


# analysis = Model.Analyses[0]
# rd = find_or_add(analysis, RESULT_NAME)

# try:
    # rd.DefineBy = LoadDefineBy.Components
# except Exception:
    # pass

# times, cols = read_file(FILE_PATH)
# t_quant = [Quantity(t, "sec") for t in times]

# pairs = []
# for i, comp in enumerate(DATA_ORDER):
    # if i >= len(cols):
        # break
    # pairs.append((comp, cols[i]))

# with Transaction():
    # for comp_name, values in pairs:
        # if not hasattr(rd, comp_name):
            # continue
        # comp = getattr(rd, comp_name)
        # unit = UNITS.get(comp_name, "m")
        # try:
            # comp.Inputs[0].DiscreteValues = t_quant
            # comp.Output.DiscreteValues = [Quantity(v, unit) for v in values]
        # except Exception as e:
            # print(comp_name, repr(e))

acc = None
for child in analysis.Children:
    if child.Name == "Acceleration":
        acc = child
        acc.Suppressed = False
        break
		
# Remote_Displacement = None
# for child in analysis.Children:
    # if child.Name == "Remote Displacement":
        # Remote_Displacement = child
        # Remote_Displacement.Suppressed = False
        # break

solution = analysis.Solution
solution.Solve()

for res_obj in solution.Children:
    if res_obj.GetType().Name == "TotalDeformation":
        res_obj.Delete()

total_def = solution.AddTotalDeformation()
total_def.Name = "Total Deformation"
total_def.EvaluateAllResults()

Graphics.Camera.FocalPoint = Point([-9.1048799732785351e-17, 0.34197742711468815, -2.6931680805189744e-05], 'm')
Graphics.Camera.ViewVector = Vector3D(0.57735026918962562, 0.57735026918962584, 0.57735026918962584)
Graphics.Camera.UpVector = Vector3D(-0.40824829046386313, 0.81649658092772592, -0.40824829046386313)
Graphics.Camera.SceneHeight = Quantity(1.3976442501719051, 'm')
Graphics.Camera.SceneWidth = Quantity(1.3976442501719051, 'm')

gfx = ExtAPI.Graphics
save_path = r"J:\ST\AW\fa\fa1\result\TotalDeform_Result.png"
gfx.ExportImage(save_path)

import os

OUT_PATH = r"J:\ST\AW\fa\fa1\Stress_Envelope_Summary.txt"
UNIT = "Pa"

RESULT_NAMES = [
    "Equivalent Stress",
    "Equivalent Stress fati",
    "Equivalent Stress daoxiangjian",
    "Equivalent Stress fagan",
    "Equivalent Stress zhaban",
]


def find_result(sol, name):
    for o in sol.Children:
        try:
            if str(o.Name) == name:
                return o
        except Exception:
            continue
    return None


def envelope(obj, attr):
    try:
        return float(getattr(obj, attr).Value)
    except Exception:
        return None


def fmt(v):
    if v is None:
        return "n/a"
    return "%.8e" % v


sol = Model.Analyses[0].Solution

rows = []
for name in RESULT_NAMES:
    obj = find_result(sol, name)
    if obj is None:
        rows.append((name, None, None))
        continue
    rows.append((name,
                 envelope(obj, "MaximumOfMaximumOverTime"),
                 envelope(obj, "MinimumOfMinimumOverTime")))

drive = os.path.splitdrive(OUT_PATH)[0]
d = os.path.dirname(OUT_PATH)

if not os.path.isdir(os.path.join(drive, os.sep)):
    raise Exception("Drive not available: " + drive)

if d and not os.path.isdir(d):
    os.makedirs(d)

lines = ["Result\tMax\tMin\tUnit"]
for name, mx, mn in rows:
    lines.append("%s\t%s\t%s\t%s" % (name, fmt(mx), fmt(mn), UNIT))

f = open(OUT_PATH, "w")
try:
    for line in lines:
        f.write(line + "\n")
finally:
    f.close()