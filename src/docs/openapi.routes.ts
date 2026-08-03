import { Router } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";

import { openApiDocument } from "./openapi.js";

const router = Router();

router.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

router.get("/openapi.json", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(openApiDocument);
});

router.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "Salon Booking API Docs",
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: "none",
      filter: true,
      validatorUrl: null,
    },
  }),
);

export default router;
