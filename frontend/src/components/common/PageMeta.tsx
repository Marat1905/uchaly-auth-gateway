import { Helmet } from "react-helmet-async";
import { useEffect } from "react";

type PageMetaProps = {
    title: string;
    description: string;
};

const PageMeta = ({ title, description }: PageMetaProps) => {
    // Дублируем изменение title для надежности
    useEffect(() => {
        document.title = title;
    }, [title]);

    return (
        <Helmet>
            <title>{title}</title>
            <meta name="description" content={description} />
        </Helmet>
    );
};

export default PageMeta;