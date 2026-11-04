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

initial_condition1 = None
for child in analysis.Children:
    if child.Name == "Initial Temperature":
        initial_condition1 = child
        break
		
initial_condition1.InitialTemperatureValue = Quantity(180, "C")

ansys_analysis_settings1 = None
for child in analysis.Children:
    if child.Name == "Analysis Settings":
        ansys_analysis_settings1 = child
        break

ansys_analysis_settings1.StepEndTime = Quantity(0.04, "sec")
step_index_list = [1]
with Transaction():
    for step_index in step_index_list:
        ansys_analysis_settings1.TimeStep = Quantity(0.02, "sec")
		
convection1 = None
for child in analysis.Children:
    if child.Name == "Convection":
        convection1 = child
        break

convection1.FilmCoefficient.Output.SetDiscreteValue(0, Quantity(10, "W m^-1 m^-1 C^-1"))
convection1.AmbientTemperature.Output.SetDiscreteValue(0, Quantity(20, "C"))
convection1.Suppressed = False

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

DO_IMPORT = True

def walk(node):
    for c in node.Children:
        yield c
        for x in walk(c):
            yield x

def import_now(obj):
    if "Import" in dir(obj):
        obj.Import()
    elif "ImportLoad" in dir(obj.Parent):
        obj.Parent.ImportLoad()
    else:
        raise Exception("no import method available")

it = next((o for o in walk(Model) if o.Name.startswith("Imported Temperature")), None)
if it is None:
    raise Exception("Imported Temperature not found")

it.GetTableByName(it.Name).Clear()
it.PropertyByName("PROPID_CFDAnalysisTimeDefinition").InternalValue = 0 
if DO_IMPORT:
    import_now(it)

solution = analysis.Solution
solution.Solve()