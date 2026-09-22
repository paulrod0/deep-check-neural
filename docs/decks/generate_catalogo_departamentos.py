#!/usr/bin/env python3
"""Genera el catálogo de automatización por departamentos (HTML A4 -> PDF con Chrome)."""

import html
from pathlib import Path

OUT_HTML = Path(__file__).parent / "catalogo_automatizacion_departamentos.html"

MARCA = "PABLO LÓPEZ · GRUPO OPTIMUS / ZEUS ENERGÍA"
EMAIL = "pablo.lprdz@gmail.com"

# ---------------------------------------------------------------- departamentos
# (código, nombre, tagline, hoy, [procesos], [(valor, etiqueta)], [palancas])
DEPARTAMENTOS = [
    (
        "D01", "Dirección y control de gestión",
        "Decidir sobre el dato de ayer, no sobre el del mes pasado.",
        "El cuadro de mando se monta a mano en Excel el día 10, con datos de tres sitios que nunca cuadran. "
        "Cuando por fin está listo, ya no sirve para decidir.",
        [
            "Cuadro de mando único que se actualiza solo: ventas, margen, caja, cartera y producción",
            "Consolidación automática de ERP, CRM, banco y hojas de cálculo sueltas",
            "Informe mensual de dirección redactado y enviado sin que nadie lo toque",
            "Alertas cuando un indicador se sale de rango: margen, morosidad, stock, desvío de obra",
            "Previsión de ventas y de tesorería a 3–6 meses con el histórico real",
            "Comparativa presupuesto contra real por centro de coste, delegación o proyecto",
            "Ranking automático de clientes, productos, delegaciones y comerciales",
            "Actas y resúmenes de reunión desde el audio, con las tareas ya repartidas",
            "Panel propio para socios, consejo o inversores, con su nivel de acceso",
            "Detección de anomalías y desviaciones antes del cierre, no después",
            "Informes a medida para cada responsable, solo con lo que le toca",
            "Consolidación de varias sociedades o delegaciones en un único cierre",
            "Simulación de escenarios: sube un coste, cae un cliente, abres delegación",
            "Seguimiento de objetivos por área con semáforo semanal",
            "Envío del informe por correo o WhatsApp a quien lo necesita, sin pedirlo",
        ],
        [("2 min", "montar el informe"), ("1 sola", "versión de la verdad"), ("Diario", "en vez de mensual")],
        ["Integración ERP/CRM", "Almacén de datos", "Paneles web", "Alertas", "Previsión"],
    ),
    (
        "D02", "Administración y contabilidad",
        "El tecleo de datos lo hace la máquina.",
        "Alguien pica facturas una por una. Cada error se paga dos veces: al detectarlo y al corregirlo. "
        "Y el cierre siempre llega tarde.",
        [
            "Lectura automática de facturas de proveedor desde PDF, foto o correo",
            "Extracción de base, IVA, retención, CIF, vencimiento y cuenta contable",
            "Casación automática de factura contra albarán y contra pedido",
            "Conciliación bancaria contra el extracto (norma 43) sin repasar línea a línea",
            "Archivo documental con nombre normalizado y búsqueda instantánea",
            "Modelos de Hacienda (303, 111, 130, 347, 349) con los datos ya cuadrados",
            "Detección de duplicados, importes fuera de contrato y facturas repetidas",
            "Envío de facturas de venta al cliente y a la plataforma que exija cada uno",
            "Gastos y tickets de empleados: foto, validación y contabilización",
            "Cierre mensual asistido con una lista de comprobación que se marca sola",
            "Remesas y ficheros bancarios generados desde la contabilidad",
            "Aviso automático al responsable cuando falta una factura o un justificante",
            "Contabilización automática de nóminas y de seguros sociales",
            "Control de amortizaciones e inmovilizado",
            "Circuito de aprobación de facturas por importe y por responsable",
            "Cuadro para la gestoría o el auditor, montado sin pedir nada a nadie",
        ],
        [("95 %", "menos tecleo"), ("Días", "en vez de semanas"), ("100 %", "trazabilidad")],
        ["OCR + IA de documentos", "Integración ERP", "Norma 43", "Validación de reglas"],
    ),
    (
        "D03", "Finanzas y tesorería",
        "Saber lo que va a pasar en la cuenta antes de que pase.",
        "La previsión de caja vive en la cabeza de una persona y en un Excel que solo entiende ella. "
        "Las sorpresas llegan el día del vencimiento.",
        [
            "Previsión de caja diaria a partir de cobros y pagos reales, no estimados",
            "Remesas SEPA de cobro y de pago generadas, validadas y enviadas",
            "Control de pólizas, líneas de crédito, avales y vencimientos financieros",
            "Escenarios «qué pasa si»: se retrasa un cobro grande, suben los tipos, cae un cliente",
            "Conciliación de comisiones bancarias y detección de cargos indebidos",
            "Seguimiento de subvenciones, hitos y plazos de justificación",
            "Reporting a banco e inversores con el mismo formato cada mes",
            "Coste y margen por proyecto en tiempo real, no al terminar",
            "Alertas de saldo mínimo y de descubierto previsto con días de antelación",
            "Control de gasto por tarjeta, delegación y responsable",
            "Cuadre automático entre contabilidad y banco",
            "Presupuesto anual y su seguimiento mes a mes",
            "Rentabilidad real por cliente, producto y delegación",
            "Cálculo de precios y de punto muerto con el coste actualizado",
            "Aviso de vencimiento de pagarés, confirming y efectos",
        ],
        [("90 días", "de visibilidad"), ("0", "sorpresas de caja"), ("Auto", "remesas y ficheros")],
        ["Agregación bancaria", "SEPA", "Modelos de previsión", "Paneles"],
    ),
    (
        "D04", "Facturación, cobros y morosidad",
        "Cobrar antes, reclamar solo y sin desgaste.",
        "Reclamar impagos es incómodo, así que se retrasa. Cada semana de retraso es dinero parado "
        "y una conversación más difícil.",
        [
            "Emisión automática de facturas recurrentes, por hitos o por parte de trabajo",
            "Envío, acuse de recibo y reenvío automático si el cliente no la abre",
            "Escalado de reclamación por tramos: recordatorio, aviso firme, requerimiento legal",
            "Ficha de riesgo por cliente con histórico de pago y deuda viva",
            "Bloqueo automático de nuevos pedidos a clientes en riesgo",
            "Conciliación de cobros con las facturas abiertas, sin repasar el banco",
            "Enlace de pago dentro de la propia factura",
            "Informe semanal de cartera vencida por comercial y por antigüedad",
            "Preparación del expediente completo para reclamación judicial o aseguradora",
            "Aviso al comercial antes de que su cliente entre en mora",
            "Recibos domiciliados y gestión automática de devoluciones",
            "Refacturación de gastos y de suplidos al cliente",
            "Facturación electrónica obligatoria y su registro (Verifactu, FACe)",
            "Aviso al cliente antes del cargo, para evitar la devolución",
            "Planes de pago y fraccionamientos controlados solos",
        ],
        [("−30 %", "periodo medio de cobro"), ("Auto", "escalado de avisos"), ("Semanal", "foto de cartera")],
        ["Facturación electrónica", "Pasarela de pago", "Reglas de escalado", "CRM"],
    ),
    (
        "D05", "Ventas y desarrollo de negocio",
        "Que el comercial venda, no que rellene formularios.",
        "El comercial pierde media jornada en pasar datos al CRM y en montar ofertas en Word. "
        "El lead que no se contesta en una hora, se pierde.",
        [
            "Alta de leads desde web, WhatsApp, correo y llamada directamente en el CRM",
            "Enriquecimiento del contacto: empresa, sector, tamaño, CIF, actividad",
            "Cualificación y puntuación automáticas, con reparto al comercial que toca",
            "Ofertas y presupuestos generados en minutos, con precios y márgenes ya aplicados",
            "Propuesta en PDF con tu marca, lista para enviar y para firmar",
            "Seguimiento automático: si no contesta en X días, recordatorio con contenido útil",
            "Actualización del CRM desde la transcripción de la llamada o de la visita",
            "Rescate de oportunidades dormidas en la base de datos histórica",
            "Comisiones calculadas solas y visibles para el comercial",
            "Previsión de cierre por embudo, con probabilidad basada en el histórico",
            "Configurador de producto o servicio para cotizaciones complejas",
            "Respuesta automática a licitaciones y pliegos con documentación reutilizable",
            "Preparación de la visita: ficha resumida del cliente antes de entrar",
            "Catálogo y tarifas siempre actualizados en el móvil del comercial",
            "Firma del pedido en el momento, desde tableta o móvil",
            "Alta del cliente en el ERP en cuanto firma, sin volver a teclear",
        ],
        [("Minutos", "para una oferta"), ("< 5 min", "respuesta al lead"), ("Más", "visitas por semana")],
        ["CRM", "Generación de PDF", "Transcripción", "Reglas de precio"],
    ),
    (
        "D06", "Marketing y contenidos",
        "Presencia constante sin una agencia detrás.",
        "Publicar con constancia exige tiempo que nadie tiene. Se publica a rachas y el catálogo "
        "online se queda a medias.",
        [
            "Calendario y publicación programada en todos los canales a la vez",
            "Redacción de contenidos con tu tono, tu argumentario y tus datos",
            "Un mismo contenido adaptado a cada red, formato e idioma",
            "Fichas de producto y textos SEO para catálogos de miles de referencias",
            "Newsletters segmentadas por comportamiento real del contacto",
            "Clasificación y respuesta de comentarios y reseñas",
            "Informe de rendimiento por canal, campaña y euro invertido",
            "Vigilancia de competencia, de precios y de novedades del sector",
            "Generación de imágenes y de vídeo corto para campaña",
            "Traducción y localización del catálogo y de la web",
            "Detección de qué contenido genera contactos de verdad",
            "Respuesta automática a formularios y a mensajes de redes",
            "Reutilización del histórico: lo que funcionó se vuelve a lanzar",
            "Páginas de campaña montadas por producto o por promoción",
            "Reseñas: se pide al cliente satisfecho y se avisa si llega una negativa",
        ],
        [("Diario", "sin dedicarle el día"), ("×10", "fichas de producto"), ("Auto", "informe de campaña")],
        ["IA generativa", "APIs de redes", "SEO técnico", "Analítica"],
    ),
    (
        "D07", "Atención al cliente y soporte",
        "Responder siempre, a cualquier hora, con tu criterio.",
        "El teléfono y el WhatsApp interrumpen todo el día con las mismas diez preguntas. "
        "Fuera de horario, nadie responde.",
        [
            "Asistente 24/7 en web y WhatsApp que responde con TU documentación, no con internet",
            "Clasificación y priorización automática de tickets y de correos entrantes",
            "Respuesta propuesta al agente, con todo el histórico del cliente delante",
            "Escalado inmediato cuando detecta enfado, urgencia o riesgo de fuga",
            "Consulta de estado de pedido, envío o incidencia sin intervención humana",
            "Encuestas de satisfacción y análisis de lo que realmente dicen",
            "Base de conocimiento que se escribe sola con los casos ya resueltos",
            "Resumen automático de la conversación al cerrar el caso",
            "Detección de motivos recurrentes y aviso al departamento responsable",
            "Atención en varios idiomas sin ampliar la plantilla",
            "Cita previa y agenda gestionadas por el propio asistente",
            "Reparto de casos por carga de trabajo y por especialidad",
            "Aviso al cliente en cada cambio de estado, sin que pregunte",
            "Detección de clientes en riesgo de fuga por su patrón de contacto",
            "Teléfono, correo, web y WhatsApp en una única bandeja",
        ],
        [("24/7", "sin turno de noche"), ("70 %", "consultas resueltas solas"), ("Segundos", "primera respuesta")],
        ["Asistente con tu documentación", "WhatsApp Business", "Clasificación", "Integración con ERP"],
    ),
    (
        "D08", "Compras y proveedores",
        "Comprar al precio pactado, con el proveedor en regla.",
        "Se pide precio a tres proveedores por correo y la comparativa se hace de memoria. "
        "La documentación del proveedor caduca y nadie se entera hasta la auditoría.",
        [
            "Petición de oferta a varios proveedores y comparativa automática en una tabla",
            "Alta y validación de proveedor: CIF, seguro, certificados, situación con Hacienda",
            "Control de caducidad de la documentación obligatoria del proveedor",
            "Pedidos automáticos al llegar al punto de reposición",
            "Seguimiento de plazos de entrega y aviso anticipado de retrasos",
            "Verificación de que el precio facturado es el precio pactado",
            "Histórico de precios por referencia y detección de subidas encubiertas",
            "Evaluación periódica de proveedores con criterios objetivos",
            "Gestión de garantías, devoluciones y abonos",
            "Control de contratos marco y de consumos comprometidos",
            "Aviso cuando el consumo se sale de lo contratado",
            "Homologación de proveedores con su expediente completo",
            "Pedido automático de material recurrente según consumo histórico",
            "Control de portes, recargos y condiciones especiales",
            "Reclamación automática de albaranes y de facturas pendientes",
        ],
        [("Auto", "comparativa de ofertas"), ("0", "documentos caducados"), ("Alerta", "si el precio no cuadra")],
        ["Comparadores", "Validación documental", "Punto de reposición", "Integración ERP"],
    ),
    (
        "D09", "Logística, almacén e inventario",
        "Saber qué hay, dónde está y cuándo llega.",
        "El stock del sistema y el del almacén no coinciden. Las rutas se montan a ojo y el cliente "
        "llama para preguntar dónde está su pedido.",
        [
            "Stock en tiempo real y aviso de rotura antes de que se produzca",
            "Etiquetas, códigos de barras y albaranes generados solos",
            "Optimización de rutas de reparto por carga, zona y ventana horaria",
            "Seguimiento de envíos y aviso proactivo al cliente sin que lo pida",
            "Inventario por escaneo con móvil o pistola, sin listados en papel",
            "Cuadre automático de inventario y detección de mermas",
            "Asignación de picking por zonas y por operario",
            "Documentación de exportación, aduanas e Intrastat",
            "Previsión de demanda por estacionalidad y por histórico",
            "Trazabilidad completa por lote, número de serie o matrícula",
            "Control de ubicaciones y reubicación sugerida por rotación",
            "Reserva de stock por pedido, por obra o por proyecto",
            "Devoluciones y logística inversa gestionadas de principio a fin",
            "Control de material en depósito en casa del cliente",
            "Aviso de caducidades y de material obsoleto",
        ],
        [("Tiempo real", "stock fiable"), ("−20 %", "km por ruta"), ("0", "llamadas de «¿dónde está?»")],
        ["Escaneo móvil", "Optimización de rutas", "Integración con transportistas", "IoT"],
    ),
    (
        "D10", "Operaciones y producción",
        "La planta se mide sola.",
        "Los partes se rellenan en papel y se pasan a Excel al día siguiente. El coste real de una "
        "orden se conoce cuando ya no se puede corregir.",
        [
            "Partes de producción digitales desde tableta o móvil, sin papel",
            "Planificación de carga de máquina, de turnos y de personal",
            "Escandallos y coste real por orden de fabricación",
            "Control de paradas, mermas y eficiencia (OEE) automático",
            "Mantenimiento preventivo disparado por horas de uso o por ciclos",
            "Captura directa desde máquinas y sensores, sin intermediarios",
            "Consumo energético por línea, por turno y por producto",
            "Detección de defectos por visión artificial en línea",
            "Trazabilidad de la materia prima hasta el cliente final",
            "Avisos de cuello de botella y de desvío sobre lo planificado",
            "Plan de producción recalculado al entrar un pedido urgente",
            "Instrucciones de trabajo en pantalla, siempre en su última versión",
            "Registro de tiempos por operario y por fase, sin apuntarlos",
            "Control de calidad en línea con la evidencia ya archivada",
            "Aviso al comercial cuando su pedido entra y cuando sale",
        ],
        [("En vivo", "coste por orden"), ("Menos", "paradas no planificadas"), ("0", "papel en planta")],
        ["IoT / sensores", "Visión artificial", "Planificación", "Terminales de planta"],
    ),
    (
        "D11", "Ingeniería, técnica y proyectos",
        "El cálculo y la memoria técnica, resueltos con los datos del proyecto.",
        "Cada propuesta técnica arranca copiando la anterior. Los cálculos viven en un Excel heredado "
        "que solo una persona sabe tocar.",
        [
            "Cálculos y dimensionados que hoy se hacen a mano, con reglas propias",
            "Memorias técnicas, anexos y pliegos generados con los datos del proyecto",
            "Diseño preliminar automático (por ejemplo, distribución sobre plano o sobre imagen real)",
            "Comparativa de soluciones y de escenarios técnico-económicos",
            "Certificados, fichas técnicas y documentación de entrega",
            "Control de horas, avance y desviación por proyecto",
            "Versionado de planos y documentación con el vigente siempre marcado",
            "Presupuestos técnicos a partir de mediciones o de captura de campo",
            "Listas de comprobación de puesta en marcha y actas de recepción",
            "Reutilización del histórico de proyectos como base de la siguiente propuesta",
            "Captura de datos de campo desde el móvil, con fotos y medidas",
            "Expediente completo de legalización generado con el proyecto",
            "Presupuesto y rentabilidad del proyecto calculados en paralelo",
            "Seguimiento de hitos, certificaciones y facturación por avance",
            "Biblioteca de soluciones tipo, reutilizable en cada propuesta",
        ],
        [("Horas → min", "propuesta técnica"), ("1 fuente", "de cálculo"), ("Auto", "memoria y anexos")],
        ["Motores de cálculo", "Generación documental", "Visión por computador", "Cartografía"],
    ),
    (
        "D12", "Recursos humanos",
        "Menos papeleo por persona, más personas atendidas.",
        "Cada alta son quince tareas manuales repartidas entre tres departamentos. "
        "Los currículums se acumulan sin leer.",
        [
            "Criba y resumen de currículums con ranking por criterios objetivos",
            "Agendado de entrevistas sin cadena de correos",
            "Onboarding automático: contrato, alta, accesos, equipo y formación inicial",
            "Registro horario y control de horas extra conforme a normativa",
            "Vacaciones, permisos y calendario del equipo con aprobación en un clic",
            "Preparación de nómina con todas las incidencias ya recogidas",
            "Avisos de formación, EPIs, reconocimientos médicos y renovaciones",
            "Encuestas de clima y análisis de las respuestas abiertas",
            "Documentación laboral firmada digitalmente y archivada por trabajador",
            "Salida ordenada: baja de accesos y devolución de equipo el mismo día",
            "Portal del empleado: nóminas, certificados y solicitudes sin preguntar a nadie",
            "Publicación de ofertas de empleo en varios portales a la vez",
            "Contratos y anexos generados y enviados a firma",
            "Coste de personal por área, por proyecto y por obra",
            "Evaluaciones y planes de carrera con recordatorio automático",
        ],
        [("15 → 1", "tareas por alta"), ("Minutos", "criba de 200 CV"), ("100 %", "registro horario")],
        ["Firma electrónica", "Portal del empleado", "IA de documentos", "Integración con gestoría"],
    ),
    (
        "D13", "Calidad, cumplimiento y auditoría",
        "Llegar a la auditoría con todo hecho.",
        "La semana antes de la auditoría se para la empresa para reunir papeles. "
        "Las no conformidades se pierden en correos.",
        [
            "Registros de calidad digitales, con evidencia y sello de tiempo",
            "No conformidades: apertura, acción correctiva, seguimiento y cierre",
            "Carpeta de auditoría ISO montada sola, con la documentación vigente",
            "Control de caducidad de certificados, calibraciones y homologaciones",
            "Trazabilidad completa por lote, expediente o instalación",
            "Cuadro de indicadores de calidad y de reclamaciones",
            "Gestión documental con control de versiones y firmas",
            "Auditorías internas programadas, con su informe generado",
            "Cumplimiento sectorial: PRL, APPCC, RGPD, normativa propia",
            "Alertas de incumplimiento antes de que sea un hallazgo",
            "Reclamaciones y encuestas de cliente integradas en el sistema de calidad",
            "Registro de formación y de competencias del personal",
            "Control de proveedores críticos y de sus evaluaciones",
            "Informe de revisión por la dirección generado con los datos del año",
        ],
        [("Días → 0", "preparar auditoría"), ("Sellado", "en el momento"), ("Auto", "informe interno")],
        ["Gestión documental", "Sello de tiempo", "Flujos de aprobación", "Paneles"],
    ),
    (
        "D14", "Legal y contratación",
        "Contratos que se revisan, se firman y no se olvidan.",
        "Los contratos se revisan a fondo o no se revisan. Las renovaciones automáticas saltan "
        "porque nadie vigilaba el preaviso.",
        [
            "Revisión de contratos con las cláusulas de riesgo señaladas en minutos",
            "Generación de contratos desde plantilla con los datos ya cargados",
            "Firma electrónica con validez legal y archivo automático",
            "Control de vencimientos, renovaciones y plazos de preaviso",
            "Repositorio contractual consultable en lenguaje natural",
            "Comparación de versiones y de un contrato contra el modelo propio",
            "RGPD: registro de tratamientos, consentimientos y derechos de los interesados",
            "Apertura de expedientes y control de plazos procesales",
            "Reclamaciones, requerimientos y burofax generados y enviados",
            "Alertas de cambio normativo que afecta a tus contratos tipo",
            "Plantillas siempre actualizadas a la última versión jurídica",
            "Control de poderes, apoderamientos y firmas autorizadas",
            "Propiedad industrial e intelectual con sus renovaciones vigiladas",
            "Documentación preparada para due diligence o auditoría legal",
        ],
        [("Minutos", "revisar un contrato"), ("0", "renovaciones no queridas"), ("Buscable", "todo el archivo")],
        ["IA de documentos legales", "Firma electrónica", "Control de plazos", "Búsqueda semántica"],
    ),
    (
        "D15", "IT y sistemas",
        "Que los programas que ya tienes se hablen entre ellos.",
        "Hay cuatro programas y ninguno se comunica, así que las personas hacen de cable: "
        "exportan de uno e importan en otro.",
        [
            "Integración entre programas que hoy no se hablan, sin cambiar de ERP",
            "Migración y sincronización de datos entre sistemas antiguos y nuevos",
            "Copias de seguridad verificadas de verdad, no solo programadas",
            "Monitorización con aviso antes de que el usuario note la caída",
            "Altas, bajas y permisos de usuario centralizados",
            "Inventario de equipos, licencias y renovaciones",
            "Despliegues automáticos y entorno de pruebas separado",
            "Detección de accesos anómalos y de fuga de información",
            "Portal interno único como puerta de entrada a todo",
            "Automatización sobre programas cerrados que no tienen conexión (escritorio o web)",
            "Panel único con el estado de todos los sistemas",
            "Tareas repetitivas de soporte interno resueltas solas",
            "Documentación técnica generada por el propio sistema",
            "Control del coste de licencias y de servicios en la nube",
            "Plan de continuidad probado de verdad, no solo escrito",
        ],
        [("Sin cambiar", "de ERP"), ("Auto", "altas y bajas"), ("Antes", "de que se note")],
        ["APIs e integraciones", "Automatización de escritorio", "Monitorización", "Control de accesos"],
    ),
    (
        "D16", "Postventa, mantenimiento y SAT",
        "El técnico cierra el aviso en casa del cliente.",
        "El parte se rellena en papel, se pierde por el camino y se factura tres semanas después "
        "—si es que se factura.",
        [
            "Parte de trabajo en el móvil del técnico, con fotos y firma del cliente",
            "Planificación y asignación de avisos por zona, carga y especialidad",
            "Contratos de mantenimiento con visitas preventivas programadas solas",
            "Historial completo por equipo instalado y por ubicación",
            "Presupuesto de reparación emitido en la propia visita",
            "Facturación del parte sin volver a la oficina",
            "Control de repuestos en furgoneta y reposición automática",
            "Encuesta al cliente al cerrar el aviso",
            "Aviso de garantías y de contratos próximos a vencer",
            "Diagnóstico asistido a partir del histórico de averías",
            "Autoservicio del cliente: abre el aviso y ve su estado sin llamar",
            "Rutas del día calculadas la noche anterior",
            "Aviso de revisiones obligatorias por normativa",
            "Rentabilidad por contrato de mantenimiento y por técnico",
        ],
        [("Mismo día", "parte y factura"), ("Más", "avisos por técnico"), ("0", "partes perdidos")],
        ["App de campo", "Firma en dispositivo", "Planificación por zona", "Integración con facturación"],
    ),
    (
        "D17", "Conocimiento interno y formación",
        "Que lo que sabe la empresa no se vaya con las personas.",
        "El conocimiento está en la cabeza de tres personas y en carpetas que nadie encuentra. "
        "Cuando una se va, se va con ella.",
        [
            "Buscador que responde con tus documentos, no con internet",
            "Asistente interno que conoce tus procedimientos, precios y casos",
            "Manuales y procedimientos que se actualizan al cambiar el proceso",
            "Itinerario de formación para nuevos, con seguimiento del avance",
            "Transcripción y resumen de reuniones, visitas y formaciones",
            "Captura del conocimiento de quien se jubila o cambia de puesto",
            "Respuestas internas de RRHH, IT y administración sin molestar a nadie",
            "Control de qué versión de cada documento es la vigente",
            "Preguntas frecuentes internas que se generan solas con lo que se pregunta",
            "Buscador único sobre correo, unidad compartida y carpetas antiguas",
            "Fichas de producto y argumentarios accesibles desde el móvil",
            "Incorporación técnica guiada paso a paso",
            "Detección de procedimientos obsoletos o contradictorios entre sí",
            "Historial de decisiones y del motivo por el que se tomaron",
        ],
        [("Segundos", "encontrar el dato"), ("Menos", "interrupciones internas"), ("Retenido", "el conocimiento")],
        ["Búsqueda semántica", "Asistente sobre tu documentación", "Transcripción", "Gestión documental"],
    ),
    (
        "D18", "Seguridad, identidad y antifraude",
        "Saber que quien está al otro lado es quien dice ser.",
        "Se dan de alta clientes y proveedores con un DNI escaneado que nadie comprueba. "
        "Hoy un documento o un vídeo falso se genera en un minuto.",
        [
            "Verificación de identidad de clientes y proveedores a distancia",
            "Detección de documentos manipulados: DNI, nóminas, facturas, contratos, justificantes",
            "Detección de deepfakes en foto y en vídeo",
            "Prueba de vida en el alta que impide suplantaciones",
            "Control de fraude en la incorporación de nuevos clientes (KYC / AML)",
            "Verificación de que quien firma es quien dice ser",
            "Registro forense con sello de tiempo, válido como prueba",
            "Alerta de intento de fraude en el momento, no en el cierre",
            "Cumplimiento de normativa de identidad digital",
            "Comprobación contra listas de sanciones y de riesgo",
            "Verificación de titularidad de cuenta antes de ordenar un pago",
            "Detección de correos de suplantación dirigidos a administración",
            "Doble validación automática para pagos por encima de un importe",
            "Auditoría de quién accedió a qué documento y cuándo",
        ],
        [("Segundos", "verificar identidad"), ("Prueba", "con validez forense"), ("Antes", "del alta")],
        ["Biometría", "Análisis forense de documentos", "Detección de deepfakes", "Sellado de tiempo"],
    ),
]

# señales de que ese departamento necesita automatización (3 por departamento)
SENALES = {
    "D01": ["Cierras el mes y el informe llega el día 15",
            "Cada área trae sus propios números y no cuadran",
            "Decides con la sensación, no con el dato"],
    "D02": ["Hay una persona dedicada a picar facturas",
            "El cierre contable siempre se retrasa",
            "Han aparecido facturas pagadas dos veces"],
    "D03": ["La previsión de caja está en un Excel personal",
            "Te enteras del descubierto el mismo día",
            "No sabes qué proyecto gana dinero de verdad"],
    "D04": ["Reclamar un impago se pospone siempre",
            "No sabes tu periodo medio de cobro",
            "Se sigue sirviendo a clientes que ya deben"],
    "D05": ["El comercial dedica más tiempo al CRM que a vender",
            "Una oferta tarda días en salir",
            "Hay leads de la semana pasada sin contestar"],
    "D06": ["Se publica a rachas, cuando hay hueco",
            "El catálogo online lleva meses a medias",
            "No sabes qué campaña trae clientes"],
    "D07": ["Las mismas diez preguntas, todos los días",
            "Fuera de horario no contesta nadie",
            "Los correos se pierden entre todos"],
    "D08": ["Comparas ofertas de proveedor de memoria",
            "Tienes documentación de proveedor caducada",
            "Te han facturado a un precio distinto del pactado"],
    "D09": ["El stock del sistema no es el del almacén",
            "Las rutas se montan a ojo cada mañana",
            "El cliente llama para saber dónde está su pedido"],
    "D10": ["Los partes de producción siguen en papel",
            "El coste real se conoce cuando ya no se puede corregir",
            "Las paradas de máquina no se registran"],
    "D11": ["Cada propuesta se copia de la anterior",
            "El cálculo vive en un Excel heredado",
            "Nadie tiene claro qué plano es el bueno"],
    "D12": ["Cada alta son quince tareas manuales",
            "Los currículums se acumulan sin leer",
            "El registro horario se lleva en papel"],
    "D13": ["La semana antes de la auditoría se para la empresa",
            "Las no conformidades viven en cadenas de correo",
            "Se han caducado certificados sin que nadie avisara"],
    "D14": ["Los contratos se firman sin revisar a fondo",
            "Ha saltado una renovación que no querías",
            "Cuesta encontrar el contrato firmado de un cliente"],
    "D15": ["Se exporta de un programa para importar en otro",
            "Las copias de seguridad no se comprueban nunca",
            "Alguien que ya no está conserva accesos"],
    "D16": ["El parte llega a oficina tres semanas después",
            "Se factura tarde, o directamente no se factura",
            "Nadie sabe el histórico de ese equipo instalado"],
    "D17": ["Todo el conocimiento depende de tres personas",
            "Nadie encuentra la versión vigente de un documento",
            "Formar a alguien nuevo cuesta meses"],
    "D18": ["Se dan altas con un DNI que nadie comprueba",
            "Has recibido un justificante que parecía retocado",
            "No podrías probar quién firmó ni cuándo"],
}

CASOS = [
    ("Comercializadora de energía", "Oferta fotovoltaica de horas a minutos",
     "La IA lee la factura de luz del cliente, detecta el tejado sobre imagen real de satélite, "
     "dimensiona la instalación y devuelve una oferta en PDF de nueve páginas lista para firmar.",
     "Horas → minutos"),
    ("Distribución industrial", "Facturas de proveedor a Excel y al ERP",
     "Se lee cada factura recibida, se extraen todos los campos y se vuelca ya cuadrada. "
     "Sin plantillas por proveedor: funciona con cualquier formato.",
     "Sin tecleo"),
    ("Grupo energético", "Intranet y CRM sincronizados solos",
     "Dos procesos programados mantienen los estados de expediente sincronizados entre la intranet "
     "antigua y el CRM, y consolidan las facturas del mes en una hoja de control.",
     "2 sistemas, 0 personas"),
    ("Recambio de automoción", "Atención y catálogo por WhatsApp",
     "Un asistente en WhatsApp busca por referencia o por especificación técnica, devuelve precio "
     "y disponibilidad y pasa el pedido, integrado con el escáner del almacén.",
     "24/7"),
    ("Portal de administración pública", "Un programa que rellena el portal",
     "Un ejecutable propio inicia sesión y actualiza cientos de expedientes en el portal oficial, "
     "que no ofrece ninguna vía de integración.",
     "Sin API, igualmente automatizado"),
    ("Producto propio · Deep-Check", "Verificación de identidad y antifraude",
     "Plataforma de detección de deepfakes y de manipulación documental, con procesado biométrico "
     "en el propio navegador. Sin enviar datos biométricos a ningún servidor.",
     "Producto en producción"),
]

PROCESO = [
    ("Diagnóstico", "Una reunión. Me cuentas el proceso, lo cronometro y te digo qué parte se puede "
                    "automatizar y qué parte no merece la pena. Gratis y sin compromiso."),
    ("Propuesta cerrada", "Alcance, plazo y precio por escrito antes de empezar. Sin horas abiertas "
                          "ni facturas sorpresa."),
    ("Puesta en marcha", "Se construye sobre lo que ya tienes. Primera versión funcionando pronto, "
                         "para corregir con uso real y no con suposiciones."),
    ("Acompañamiento", "Formación al equipo, documentación y soporte. El proceso queda documentado "
                       "y es tuyo: no dependes de mí para seguir usándolo."),
]


def esc(t):
    return html.escape(t, quote=False)


def page(inner, cls="", footer_left=MARCA, footer_right=""):
    return f"""<section class="page {cls}">
{inner}
<div class="pagefoot"><span>{esc(footer_left)}</span><span>{esc(footer_right)}</span></div>
</section>"""


def build():
    pages = []
    total = len(DEPARTAMENTOS)

    # ---------------------------------------------------------------- portada
    chips = "".join(
        f"<span class='chip'>{esc(c)}</span>"
        for c in ["Automatización de procesos", "Apps a medida", "IA aplicada", "Integraciones"]
    )
    pages.append(page(f"""
<div class="covertop">
  <span class="brandmark"><b>PABLO LÓPEZ</b> · GRUPO OPTIMUS / ZEUS ENERGÍA</span>
  <span class="brandmark">MADRID · 2026</span>
</div>
<div class="coverbody">
  <p class="eyebrow">Catálogo de automatización</p>
  <h1>Qué se puede<br>automatizar en tu<br><span class="l2">empresa, departamento<br>por departamento.</span></h1>
  <p class="lede">Dieciocho áreas y 267 procesos concretos. Si un trabajo tiene reglas
  y se repite, se automatiza. Este documento es el mapa completo para encontrar los tuyos.</p>
  <div class="strip">{chips}</div>
</div>
<div class="coverfoot">
  <div><span class="ml">Contacto</span><span class="mv2">{esc(EMAIL)}</span></div>
  <div><span class="ml">Base</span><span class="mv2">Madrid, España</span></div>
  <div><span class="ml">Áreas</span><span class="mv2">{total} departamentos</span></div>
</div>""", cls="cover", footer_left="", footer_right=""))

    # ---------------------------------------------------------------- criterio
    criterios = [
        ("Se repite", "Si se hace más de una vez por semana, cada minuto ahorrado se multiplica por cien al año."),
        ("Tiene reglas", "Aunque sean reglas complicadas y llenas de excepciones. Las excepciones también se programan."),
        ("Duele el error", "Un dato mal tecleado que llega a una factura, a un pedido o a Hacienda cuesta mucho más que el minuto que se tardó."),
        ("Depende de una persona", "Si el proceso se para cuando esa persona se va de vacaciones, es un riesgo, no un proceso."),
    ]
    mitos = [
        ("«Mi proceso es demasiado particular»",
         "Casi siempre lo particular es el criterio, no la mecánica. El criterio se recoge una vez y se aplica siempre igual."),
        ("«Habría que cambiar de programa»",
         "No. Se automatiza sobre lo que ya usas. Incluso sobre programas cerrados que no permiten integración."),
        ("«Eso es para empresas grandes»",
         "Al revés: cuanto más pequeño es el equipo, más pesa cada hora que se va en tareas repetitivas."),
        ("«Va a sustituir a mi gente»",
         "Sustituye el tecleo, no a las personas. La misma plantilla atiende más clientes y comete menos errores."),
    ]
    pages.append(page(f"""
<p class="eyebrow">Cómo se decide</p>
<h2>Casi todo se puede automatizar.<br>La pregunta es por dónde empezar.</h2>
<p class="lede sub">Un proceso es buen candidato cuando cumple al menos dos de estas cuatro condiciones.
Cuando cumple las cuatro, se paga solo en semanas.</p>
<div class="grid4">
  {''.join(f'''<article class="card sm"><span class="cn">0{i+1}</span><h3>{esc(t)}</h3><p>{esc(d)}</p></article>'''
           for i, (t, d) in enumerate(criterios))}
</div>
<p class="eyebrow mt">Lo que suele frenar</p>
<div class="grid2">
  {''.join(f'''<article class="myth"><h4>{esc(t)}</h4><p>{esc(d)}</p></article>''' for t, d in mitos)}
</div>""", cls="mid", footer_right="01"))

    # ---------------------------------------------------------------- índice
    idx = "".join(
        f"""<li><span class="ix">{esc(c)}</span><span class="ixn">{esc(n)}</span><span class="ixt">{esc(tag)}</span></li>"""
        for c, n, tag, *_ in DEPARTAMENTOS
    )
    pages.append(page(f"""
<p class="eyebrow">Índice</p>
<h2>Los {total} departamentos.</h2>
<p class="lede sub">Cada uno ocupa una página: lo que pasa hoy, la lista de procesos que se automatizan
y lo que se gana con ello.</p>
<ol class="index">{idx}</ol>""", cls="mid", footer_right="02"))

    # ---------------------------------------------------------------- departamentos
    for i, (code, nombre, tagline, hoy, procesos, metricas, palancas) in enumerate(DEPARTAMENTOS):
        lis = "".join(f"<li>{esc(p)}</li>" for p in procesos)
        mets = "".join(
            f"""<div class="metric"><span class="mv">{esc(v)}</span><span class="ml">{esc(l)}</span></div>"""
            for v, l in metricas
        )
        tags = "".join(f"<span>{esc(t)}</span>" for t in palancas)
        sen = "".join(f"<li>{esc(s)}</li>" for s in SENALES[code])
        pages.append(page(f"""
<div class="dephead">
  <span class="depcode">{esc(code)}</span>
  <div>
    <h2 class="deph2">{esc(nombre)}</h2>
    <p class="deptag">{esc(tagline)}</p>
  </div>
</div>
<div class="hoy"><span class="hoyl">Hoy</span><p>{esc(hoy)}</p></div>
<p class="eyebrow sm">Procesos que se automatizan</p>
<ul class="proclist">{lis}</ul>
<div class="depbottom">
<div class="senales">
  <span class="ml">Señales de que te toca</span>
  <ul>{sen}</ul>
</div>
<div class="depfoot">
  <div class="metrics">{mets}</div>
  <div class="palancas"><span class="ml">Con qué</span><div class="tags">{tags}</div></div>
</div>
</div>""", cls="dep", footer_right=f"{i + 3:02d}"))

    n = len(pages)

    # ---------------------------------------------------------------- casos
    casos = "".join(
        f"""<article class="caso">
  <span class="cn">{esc(sector)}</span>
  <h3>{esc(titulo)}</h3>
  <p>{esc(desc)}</p>
  <span class="casoK">{esc(kpi)}</span>
</article>"""
        for sector, titulo, desc, kpi in CASOS
    )
    pages.append(page(f"""
<p class="eyebrow">Hecho, no prometido</p>
<h2>Seis procesos que ya funcionan.</h2>
<p class="lede sub">Todos en producción, con usuarios reales dentro. Sectores distintos, la misma idea:
quitar de en medio el trabajo que no aporta.</p>
<div class="grid3">{casos}</div>""", cls="mid", footer_right=f"{n + 1:02d}"))

    # ---------------------------------------------------------------- proceso
    pasos = "".join(
        f"""<li><span class="stepn">0{i+1}</span><h3>{esc(t)}</h3><p>{esc(d)}</p></li>"""
        for i, (t, d) in enumerate(PROCESO)
    )
    modelos = [
        ("Proceso a proceso", "Se elige un proceso concreto, se cierra precio y se entrega funcionando. "
                              "La forma habitual de empezar: inversión pequeña y resultado visible."),
        ("Proyecto completo", "Varios procesos de un mismo departamento o una aplicación a medida. "
                              "Por fases, con entregas parciales que ya se pueden usar."),
        ("Acompañamiento", "Cuota mensual de soporte, mejoras y nuevas automatizaciones según vayan "
                           "apareciendo. Opcional y cancelable."),
    ]
    mods = "".join(
        f"""<article class="card sm"><h3>{esc(t)}</h3><p>{esc(d)}</p></article>""" for t, d in modelos
    )
    pages.append(page(f"""
<p class="eyebrow">Cómo se trabaja</p>
<h2>Un proceso simple, sin sorpresas.</h2>
<ol class="steps">{pasos}</ol>
<p class="eyebrow mt">Formas de contratar</p>
<div class="grid3">{mods}</div>
<p class="fine">El diagnóstico inicial no se cobra. Si de esa primera reunión sale que no merece la pena
automatizarlo, te lo digo igualmente.</p>""", cls="mid", footer_right=f"{n + 2:02d}"))

    # ---------------------------------------------------------------- contacto
    pages.append(page(f"""
<div class="coverbody">
  <p class="eyebrow">Siguiente paso</p>
  <h1>Cuéntame un proceso<br>que te quite tiempo.<br><span class="l2">Te digo qué parte<br>se puede quitar.</span></h1>
  <p class="lede">Una llamada de treinta minutos. Miramos tu caso concreto y sales con una respuesta
  clara: qué se automatiza, en cuánto tiempo y qué cuesta. Sin compromiso.</p>
</div>
<div class="coverfoot">
  <div><span class="ml">Email</span><span class="mv2">{esc(EMAIL)}</span></div>
  <div><span class="ml">Base</span><span class="mv2">Madrid, España</span></div>
  <div><span class="ml">Áreas</span><span class="mv2">Automatización · Apps · IA</span></div>
</div>""", cls="cover end", footer_left="", footer_right=""))

    return "\n".join(pages)


CSS = """
:root{
  --bg:#0A0E13; --bg2:#0E141B; --panel:#131B24;
  --line:#26333F; --hair:#1D2833;
  --text:#EAEEF3; --muted:#8A97A6; --faint:#5D6B7A;
  --amber:#F2A24B; --amber-2:#F7C27A;
  --blue:#5B8DEF; --green:#42B884;
  --accent:var(--amber); --accent-2:var(--amber-2);
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,"SF Mono","JetBrains Mono","Roboto Mono",Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:#05080B;font-family:var(--sans);color:var(--text);-webkit-font-smoothing:antialiased}

.page{
  position:relative;
  width:210mm;height:297mm;
  margin:0 auto 8mm;
  padding:16mm 15mm 13mm;
  display:flex;flex-direction:column;
  overflow:hidden;
  background:
    radial-gradient(120% 70% at 88% 4%, color-mix(in srgb,var(--accent) 7%, transparent) 0%, transparent 52%),
    radial-gradient(130% 80% at 45% 112%, color-mix(in srgb,var(--accent) 12%, transparent) 0%, transparent 58%),
    linear-gradient(var(--hair) 1px,transparent 1px) 0 0/100% 56px,
    linear-gradient(90deg,var(--hair) 1px,transparent 1px) 0 0/56px 100%,
    var(--bg);
  background-blend-mode:normal,normal,soft-light,soft-light,normal;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}

h1,h2{font-weight:800;letter-spacing:-.028em;line-height:1.04;text-wrap:balance}
h1{font-size:40pt}
h2{font-size:24pt}
.l2{color:var(--accent)}
.lede{font-size:11.5pt;color:var(--muted);line-height:1.5;max-width:62ch}
.lede.sub{margin-top:10px;font-size:10.5pt}

.eyebrow{
  font-family:var(--mono);font-size:7.6pt;font-weight:500;
  letter-spacing:.24em;text-transform:uppercase;color:var(--accent);
  display:flex;align-items:center;gap:9px;
}
.eyebrow::before{content:"";width:22px;height:1px;background:var(--accent);display:inline-block}
.eyebrow.mt{margin-top:22px}
.eyebrow.sm{margin-top:14px;font-size:7pt}
.brandmark{font-family:var(--mono);font-size:7.4pt;letter-spacing:.18em;color:var(--faint);text-transform:uppercase}
.brandmark b{color:var(--muted);font-weight:600}
.ml{font-family:var(--mono);font-size:6.8pt;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);display:block}
.mv2{font-family:var(--mono);font-size:9.4pt;color:var(--text);margin-top:5px;display:block}

.pagefoot{
  position:absolute;left:15mm;right:15mm;bottom:7mm;
  display:flex;justify-content:space-between;
  font-family:var(--mono);font-size:6.6pt;letter-spacing:.16em;
  color:var(--faint);text-transform:uppercase;
  border-top:1px solid var(--hair);padding-top:5px;
}

/* ---- portada / cierre ---- */
.cover{justify-content:space-between}
.covertop{display:flex;justify-content:space-between;align-items:baseline}
.coverbody{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:18px}
.coverfoot{display:flex;gap:34px;border-top:1px solid var(--line);padding-top:14px}
.strip{display:flex;flex-wrap:wrap;gap:7px;margin-top:6px}
.chip{
  font-family:var(--mono);font-size:7.6pt;letter-spacing:.06em;color:var(--muted);
  border:1px solid var(--line);border-radius:100px;padding:6px 12px;
  background:color-mix(in srgb,var(--panel) 60%,transparent);
}
.end h1{font-size:34pt}

/* ---- tarjetas ---- */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:14px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:11px;margin-top:16px}
.grid4{display:grid;grid-template-columns:repeat(2,1fr);gap:11px;margin-top:16px}
.card{
  border:1px solid var(--line);border-radius:11px;
  background:linear-gradient(180deg,var(--panel) 0%,var(--bg2) 100%);
  padding:15px 16px 16px;display:flex;flex-direction:column;gap:7px;
  position:relative;overflow:hidden;
}
.card::before{content:"";position:absolute;top:0;left:0;width:100%;height:2px;
  background:linear-gradient(90deg,var(--accent),transparent 70%);opacity:.8}
.card .cn{font-family:var(--mono);font-size:7.4pt;color:var(--accent);letter-spacing:.14em}
.card h3{font-size:12pt;font-weight:700;letter-spacing:-.01em}
.card p{color:var(--muted);font-size:9.4pt;line-height:1.48}
.myth{border-left:2px solid var(--line);padding:4px 0 4px 14px}
.myth h4{font-size:10.4pt;font-weight:700;color:var(--accent-2)}
.myth p{color:var(--muted);font-size:9.3pt;line-height:1.5;margin-top:5px}

/* ---- índice ---- */
.index{list-style:none;margin-top:18px;display:grid;grid-template-columns:1fr 1fr;gap:0 26px}
.index li{
  display:grid;grid-template-columns:auto 1fr;gap:3px 11px;
  align-items:baseline;padding:8px 0;border-bottom:1px solid var(--hair);
}
.ix{font-family:var(--mono);font-size:8pt;color:var(--accent);letter-spacing:.1em}
.ixn{font-size:10.4pt;font-weight:700;letter-spacing:-.01em}
.ixt{grid-column:2;font-size:8.6pt;color:var(--faint);line-height:1.35}

/* ---- departamento ---- */
.depbottom{margin-top:auto;display:flex;flex-direction:column;gap:14px}
.mid{justify-content:center;padding-bottom:20mm}
.dephead{display:flex;gap:14px;align-items:flex-start}
.depcode{
  font-family:var(--mono);font-size:8pt;color:var(--accent);letter-spacing:.12em;
  border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));
  border-radius:6px;padding:5px 8px;margin-top:4px;flex:0 0 auto;
}
.deph2{font-size:22pt}
.deptag{color:var(--accent-2);font-size:10.6pt;margin-top:6px;font-weight:500}
.hoy{
  margin-top:16px;border:1px solid var(--line);border-radius:10px;
  background:color-mix(in srgb,var(--panel) 55%,transparent);
  padding:14px 16px;display:flex;gap:14px;align-items:flex-start;
}
.hoyl{
  font-family:var(--mono);font-size:6.8pt;letter-spacing:.16em;text-transform:uppercase;
  color:var(--faint);border-right:1px solid var(--line);padding-right:13px;margin-top:2px;flex:0 0 auto;
}
.hoy p{color:var(--muted);font-size:10pt;line-height:1.55}
.proclist{list-style:none;margin-top:12px;columns:2;column-gap:22px}
.proclist li{
  break-inside:avoid;position:relative;padding:0 0 17px 14px;
  color:var(--text);font-size:10.4pt;line-height:1.5;
}
.proclist li::before{content:"";position:absolute;left:0;top:.62em;width:7px;height:1px;background:var(--accent)}

.senales{
  border:1px solid var(--line);border-left:2px solid var(--accent);
  border-radius:0 10px 10px 0;padding:12px 16px 13px;
  background:color-mix(in srgb,var(--panel) 40%,transparent);
}
.senales ul{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:9px 18px;margin-top:9px}
.senales li{
  color:var(--muted);font-size:9pt;line-height:1.4;
  position:relative;padding-left:15px;
}
.senales li::before{
  content:"→";position:absolute;left:0;top:0;
  color:var(--accent);font-size:8.4pt;
}
.depfoot{display:flex;gap:24px;align-items:flex-end;border-top:1px solid var(--line);padding-top:13px;margin-bottom:4mm}
.metrics{display:flex;gap:22px;flex:0 0 auto}
.metric{display:flex;flex-direction:column;gap:2px}
.metric .mv{
  font-family:var(--mono);font-variant-numeric:tabular-nums;
  font-size:14pt;font-weight:600;color:var(--accent-2);letter-spacing:-.01em;
}
.palancas{flex:1 1 auto}
.tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.tags span{
  font-family:var(--mono);font-size:7.2pt;color:var(--muted);
  border:1px solid var(--line);border-radius:6px;padding:4px 7px;
  background:color-mix(in srgb,var(--panel) 50%,transparent);
}

/* ---- casos ---- */
.caso{
  border:1px solid var(--line);border-radius:11px;background:var(--bg2);
  padding:15px 15px 16px;display:flex;flex-direction:column;gap:7px;
}
.caso .cn{font-family:var(--mono);font-size:7pt;color:var(--faint);letter-spacing:.12em;text-transform:uppercase}
.caso h3{font-size:11.6pt;font-weight:700;letter-spacing:-.01em;line-height:1.2}
.caso p{color:var(--muted);font-size:9.2pt;line-height:1.48;flex:1 1 auto}
.casoK{
  font-family:var(--mono);font-size:7.6pt;letter-spacing:.06em;color:var(--green);
  border-top:1px solid var(--hair);padding-top:9px;margin-top:3px;
}

/* ---- proceso ---- */
.steps{list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:16px 22px;margin-top:20px}
.steps li{border-top:1px solid var(--line);padding-top:12px}
.stepn{font-family:var(--mono);font-size:15pt;font-weight:600;color:var(--accent);display:block}
.steps h3{font-size:12.4pt;font-weight:700;margin-top:7px;letter-spacing:-.01em}
.steps p{color:var(--muted);font-size:9.4pt;line-height:1.5;margin-top:6px}
.fine{margin-top:20px;color:var(--faint);font-size:8.8pt;line-height:1.5;font-style:italic}

@page{size:A4;margin:0}
@media print{
  body{background:none}
  .page{margin:0;page-break-after:always;break-after:page}
  .page:last-child{page-break-after:auto;break-after:auto}
}
"""


def main():
    doc = f"""<!doctype html>
<html lang="es">
<meta charset="utf-8">
<title>Catálogo de automatización por departamentos — Pablo López</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>{CSS}</style>
{build()}
</html>"""
    OUT_HTML.write_text(doc, encoding="utf-8")
    print(f"escrito {OUT_HTML} ({len(doc)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
