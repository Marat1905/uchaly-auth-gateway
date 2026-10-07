import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import PageMeta from "../../components/common/PageMeta";

export default function Home() {
    return (
        <>
            <PageMeta
                title="Домашняя - Главная"
                description="Домашняя - Главная"
            />

            <PageBreadcrumb pageTitle="Главная" />


            <div className="grid grid-cols-12 gap-2 md:gap-6">
                <div className="col-span-12">

                </div>
            </div>

        </>
    );
}